// supabase/functions/_shared/pnr-verification.ts
// ──────────────────────────────────────────────────────────────────
// N3 Sprint 1 (2026-04-26) — PNR-verifiering helpers.
//
// SYFTE:
//   Centralisera (rule #28 SSOT) all logik för:
//   - Klassificera PNR-verifierings-status per booking
//   - Kolla 75k-tak per customer_profile
//   - Avgöra om RUT-rapportering kan ske för en bokning
//
// FLAG-GATE: platform_settings.pnr_verification_required
//   - 'off'  = ingen check (dev/test)
//   - 'soft' = varning vid manual_klartext (default)
//   - 'hard' = blockera utan BankID
//
// REGLER: #26 grep-före-edit (helper är ny), #27 scope (bara PNR-
// verifieringslogik), #28 SSOT (alla EFs som rör RUT-PNR importerar
// härifrån), #30 inga regulator-claims (Spick-affärslogik), #31 schema
// curl-verifierat 2026-04-26.
// ──────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export interface SupabasePnrClient {
  from: (table: string) => any;
}

// ============================================================
// Typer
// ============================================================

export type PnrVerificationMethod =
  | "bankid"           // Starkast — TIC SPAR-verifierad
  | "manual_klartext"  // Svagast — VD angav, ingen verifiering
  | "unverified"       // Bokning utförd utan PNR (RUT förloras)
  | "pending_bankid";  // Väntar SMS-flow till kund

export type VerificationRequirement = "off" | "soft" | "hard";

export interface BookingPnrStatus {
  booking_id: string;
  method: PnrVerificationMethod | null;
  verified_at: string | null;
  signature_session_id: string | null;
  is_rut_safe: boolean;       // Kan RUT-rapporteras till SKV?
  needs_attention: boolean;   // Pending eller manual_klartext med risk?
}

export interface RutQuotaStatus {
  customer_email: string;
  ytd_used_sek: number;
  ytd_year: number | null;
  approaches_limit: boolean;  // > 60 000 kr
  exceeds_limit: boolean;     // > 75 000 kr
  remaining_sek: number;
}

export const RUT_ANNUAL_LIMIT_SEK = 75000;
export const RUT_WARNING_THRESHOLD_SEK = 60000;

// ============================================================
// Status-helpers
// ============================================================

/**
 * Klassificerar PNR-verifierings-status för en bokning.
 * Returnerar `is_rut_safe=true` ENBART om method='bankid' och
 * verified_at är satt. Övriga metoder är inte SKV-bevis-säkra.
 */
export function classifyBookingPnr(booking: {
  id: string;
  pnr_verification_method?: string | null;
  pnr_verified_at?: string | null;
  customer_pnr_verification_session_id?: string | null;
}): BookingPnrStatus {
  const method = (booking.pnr_verification_method as PnrVerificationMethod | null) ?? null;
  const verifiedAt = booking.pnr_verified_at ?? null;
  const sessionId = booking.customer_pnr_verification_session_id ?? null;

  const isRutSafe = method === "bankid" && !!verifiedAt && !!sessionId;
  const needsAttention = method === "pending_bankid" || method === "manual_klartext";

  return {
    booking_id: booking.id,
    method,
    verified_at: verifiedAt,
    signature_session_id: sessionId,
    is_rut_safe: isRutSafe,
    needs_attention: needsAttention,
  };
}

/**
 * Hämtar 75k-tak-status för en customer_profile.
 * Returnerar null om profilen inte finns.
 */
export async function getRutQuotaStatus(
  supabase: SupabasePnrClient,
  customerEmail: string,
): Promise<RutQuotaStatus | null> {
  const { data } = await supabase
    .from("customer_profiles")
    .select("customer_email, rut_ytd_used_sek, rut_ytd_year")
    .eq("customer_email", customerEmail.toLowerCase().trim())
    .maybeSingle();

  if (!data) return null;

  const used = Number(data.rut_ytd_used_sek) || 0;
  return {
    customer_email: data.customer_email as string,
    ytd_used_sek: used,
    ytd_year: (data.rut_ytd_year as number | null) ?? null,
    approaches_limit: used >= RUT_WARNING_THRESHOLD_SEK,
    exceeds_limit: used >= RUT_ANNUAL_LIMIT_SEK,
    remaining_sek: Math.max(0, RUT_ANNUAL_LIMIT_SEK - used),
  };
}

/**
 * Returnerar verification-requirement från platform_settings.
 * Default: 'soft' om inte satt.
 */
export async function getVerificationRequirement(
  supabase: SupabasePnrClient,
): Promise<VerificationRequirement> {
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "pnr_verification_required")
    .maybeSingle();

  const v = data?.value as string | undefined;
  if (v === "off" || v === "soft" || v === "hard") return v;
  return "soft";
}

/**
 * Avgör om en bokning får skapas givet PNR-verifierings-policy.
 * Returnerar { allowed: bool, reason: string }.
 */
export async function canCreateBookingWithPnr(
  supabase: SupabasePnrClient,
  input: {
    method: PnrVerificationMethod | null;
    rut_enabled: boolean;
  },
): Promise<{ allowed: boolean; reason: string }> {
  const requirement = await getVerificationRequirement(supabase);

  // Om RUT inte används → PNR är irrelevant
  if (!input.rut_enabled) {
    return { allowed: true, reason: "rut_not_used" };
  }

  // 'off' tillåter allt
  if (requirement === "off") {
    return { allowed: true, reason: "verification_off" };
  }

  // 'hard' kräver bankid (eller pending_bankid som ska resolva inom timeout)
  if (requirement === "hard") {
    if (input.method === "bankid" || input.method === "pending_bankid") {
      return { allowed: true, reason: "bankid_method" };
    }
    return {
      allowed: false,
      reason: `requirement=hard, method=${input.method} not allowed for RUT bookings`,
    };
  }

  // 'soft' (default): tillåt allt men varning loggas
  return {
    allowed: true,
    reason: input.method === "manual_klartext"
      ? "soft_warning_manual_klartext"
      : "soft_default",
  };
}
