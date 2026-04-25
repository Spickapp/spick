// supabase/functions/_shared/terms-acceptance.ts
// ──────────────────────────────────────────────────────────────────
// Item 1 (2026-04-25) — Terms-acceptance helpers för BankID-bunden
// signering av underleverantörsavtal + B2B-tillägg.
//
// SYFTE:
//   Centralisera (rule #28 SSOT) all logik för:
//   - Hämta aktuell bindande version per avtal-typ
//   - Kolla om en cleaner/company har accepterat aktuell version
//   - Spara accept (via BankID-flow eller soft-accept beroende på flag)
//
// PRIMÄRKÄLLA:
//   - migrations/20260425210000_item1_terms_acceptance_schema.sql
//   - platform_settings.terms_signing_required (flag-gate)
//
// FLAG-GATE:
//   - terms_signing_required = "false" (default): soft-accept räcker
//     (timestamp + version sparas men ingen BankID-binding krävs)
//   - terms_signing_required = "true": BankID-bunden accept krävs
//     (terms_signature_id måste vara satt + peka på rut_consents-rad)
//
// REGLER: #26 grep-före-edit (helper är ny), #27 scope (bara terms-
// acceptance-logik), #28 SSOT (alla EFs som rör accept importerar härifrån),
// #30 inga regulator-claims (teknik), #31 schema curl-verifierat 2026-04-25.
// ──────────────────────────────────────────────────────────────────

// Minimal client-interface som matchar både @supabase/supabase-js@2-versions.
// deno-lint-ignore no-explicit-any
export interface SupabaseTermsClient {
  from: (table: string) => any;
}

// ============================================================
// Typer
// ============================================================

export type AvtalTyp =
  | "underleverantorsavtal"
  | "b2b_tillagg"
  | "kundvillkor"
  | "integritetspolicy"
  | "code_of_conduct";

export type SubjectType = "cleaner" | "company";

export interface TermsVersion {
  id: string;
  avtal_typ: AvtalTyp;
  version: string;
  is_binding: boolean;
  publicerat_at: string;
  draft_url?: string | null;
  pdf_url?: string | null;
}

export interface AcceptanceStatus {
  current: boolean;        // accepterat aktuell bindande version
  outdated: boolean;       // accepterat tidigare version men ny binding-version finns
  never: boolean;          // aldrig accepterat
  current_version: string | null;     // aktuell bindande version
  accepted_version: string | null;    // version som subjektet accepterat (null om aldrig)
  accepted_at: string | null;         // ISO timestamp för accept
  signature_id: string | null;        // FK till rut_consents om BankID-bunden
}

// ============================================================
// Hämta aktuell bindande version per avtal-typ
// ============================================================

/**
 * Returnerar senaste version per avtal-typ där is_binding=true.
 * Om ingen bindande version finns: returnerar null.
 *
 * Cachning: ingen — varje anrop går till DB (sällan-anropad funktion).
 */
export async function getCurrentBindingVersion(
  supabase: SupabaseTermsClient,
  avtalTyp: AvtalTyp,
): Promise<TermsVersion | null> {
  const { data, error } = await supabase
    .from("avtal_versioner")
    .select("id, avtal_typ, version, is_binding, publicerat_at, draft_url, pdf_url")
    .eq("avtal_typ", avtalTyp)
    .eq("is_binding", true)
    .order("publicerat_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as TermsVersion;
}

// ============================================================
// Kolla acceptance-status för subjekt
// ============================================================

/**
 * Returnerar acceptance-status för en cleaner eller company mot aktuell
 * bindande version av angivet avtal-typ.
 *
 * Logik:
 *   - Om ingen bindande version finns → never=true (men inget krav)
 *   - Om accepted_version === current_version → current=true
 *   - Om accepted_version != current_version → outdated=true
 *   - Om accepted_version == null → never=true
 */
export async function checkAcceptanceStatus(
  supabase: SupabaseTermsClient,
  subjectType: SubjectType,
  subjectId: string,
  avtalTyp: AvtalTyp,
): Promise<AcceptanceStatus> {
  const tableName = subjectType === "cleaner" ? "cleaners" : "companies";

  const [versionResult, subjectResult] = await Promise.all([
    getCurrentBindingVersion(supabase, avtalTyp),
    supabase
      .from(tableName)
      .select("terms_accepted_at, terms_version, terms_signature_id")
      .eq("id", subjectId)
      .maybeSingle(),
  ]);

  const currentVersion = versionResult?.version ?? null;
  const subject = subjectResult?.data;
  const acceptedVersion = (subject?.terms_version as string | undefined) ?? null;
  const acceptedAt = (subject?.terms_accepted_at as string | undefined) ?? null;
  const signatureId = (subject?.terms_signature_id as string | undefined) ?? null;

  if (!currentVersion) {
    // Ingen bindande version finns → tekniskt "never" men inget krav
    return {
      current: false, outdated: false, never: true,
      current_version: null, accepted_version: acceptedVersion,
      accepted_at: acceptedAt, signature_id: signatureId,
    };
  }

  if (!acceptedVersion) {
    return {
      current: false, outdated: false, never: true,
      current_version: currentVersion, accepted_version: null,
      accepted_at: null, signature_id: null,
    };
  }

  if (acceptedVersion === currentVersion) {
    return {
      current: true, outdated: false, never: false,
      current_version: currentVersion, accepted_version: acceptedVersion,
      accepted_at: acceptedAt, signature_id: signatureId,
    };
  }

  return {
    current: false, outdated: true, never: false,
    current_version: currentVersion, accepted_version: acceptedVersion,
    accepted_at: acceptedAt, signature_id: signatureId,
  };
}

// ============================================================
// Spara acceptance
// ============================================================

export interface RecordAcceptanceInput {
  subjectType: SubjectType;
  subjectId: string;
  version: string;
  signatureId?: string | null;  // rut_consents.id om BankID-bunden, null om soft-accept
}

/**
 * Spara att subjektet har accepterat angiven version.
 * Uppdaterar cleaners/companies-raden med terms_*-kolumnerna.
 *
 * Returnerar { ok: true } vid success, { ok: false, error } vid fel.
 */
export async function recordAcceptance(
  supabase: SupabaseTermsClient,
  input: RecordAcceptanceInput,
): Promise<{ ok: boolean; error?: string }> {
  const { subjectType, subjectId, version, signatureId } = input;

  if (!subjectId || typeof subjectId !== "string") {
    return { ok: false, error: "invalid_subject_id" };
  }
  if (!version || typeof version !== "string") {
    return { ok: false, error: "invalid_version" };
  }

  const tableName = subjectType === "cleaner" ? "cleaners" : "companies";
  const update: Record<string, unknown> = {
    terms_accepted_at: new Date().toISOString(),
    terms_version: version,
    terms_signature_id: signatureId ?? null,
  };

  const { error } = await supabase
    .from(tableName)
    .update(update)
    .eq("id", subjectId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

// ============================================================
// Flag-gate-helper
// ============================================================

/**
 * Returnerar true om systemet kräver BankID-bunden accept (signature_id satt).
 * Hämtas från platform_settings.terms_signing_required.
 *
 * Default: false (soft-accept räcker).
 */
export async function isBankIdBindingRequired(
  supabase: SupabaseTermsClient,
): Promise<boolean> {
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "terms_signing_required")
    .maybeSingle();

  return data?.value === "true";
}
