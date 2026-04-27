// ═══════════════════════════════════════════════════════════════
// SPICK – check-terms-acceptance (Item 1 Etapp 3)
// ═══════════════════════════════════════════════════════════════
//
// Returnerar acceptance-status för en cleaner eller company mot
// aktuell bindande version. Frontend (stadare-dashboard.html) anropar
// vid load → om not current → visa modal.
//
// AUTH: JWT-bearer (cleaner-token från supabase auth).
//
// REGLER: #26 grep auth-pattern, #27 scope (bara terms-status,
// ingen acceptance-write), #28 SSOT (checkAcceptanceStatus från
// _shared/terms-acceptance.ts), #30 ingen regulator-claim,
// #31 schema verifierat 2026-04-25.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";
import {
  type AvtalTyp,
  checkAcceptanceStatus,
  getCurrentBindingVersion,
  isBankIdBindingRequired,
  type SubjectType,
} from "../_shared/terms-acceptance.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("check-terms-acceptance");

const VALID_SUBJECT_TYPES: ReadonlyArray<SubjectType> = ["cleaner", "company"];
const VALID_AVTAL_TYPER: ReadonlyArray<AvtalTyp> = [
  "underleverantorsavtal",
  "b2b_tillagg",
  "kundvillkor",
  "integritetspolicy",
  "code_of_conduct",
];

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isValidUuid(id: unknown): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── JWT-auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(CORS, 401, { error: "missing_auth" });
    }
    const token = authHeader.slice(7);
    if (token === ANON_KEY) {
      return json(CORS, 401, { error: "anon_not_allowed" });
    }
    const sbAuth = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser();
    if (authErr || !user) {
      return json(CORS, 401, { error: "invalid_token" });
    }

    // ── Input ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }
    const { subject_type, subject_id, avtal_typ } = body as Record<string, unknown>;

    if (!VALID_SUBJECT_TYPES.includes(subject_type as SubjectType)) {
      return json(CORS, 400, {
        error: "invalid_subject_type",
        details: { allowed: VALID_SUBJECT_TYPES },
      });
    }
    if (!isValidUuid(subject_id)) {
      return json(CORS, 400, { error: "invalid_subject_id" });
    }
    const avtalTypResolved = (avtal_typ && VALID_AVTAL_TYPER.includes(avtal_typ as AvtalTyp))
      ? avtal_typ as AvtalTyp
      : "underleverantorsavtal";

    const subjectType = subject_type as SubjectType;
    const subjectId = subject_id as string;

    // ── Authorisation ──
    // Hämta callers cleaner-record via auth_user_id (auth.users.id !== cleaners.id)
    const { data: callerCleaner } = await sbService
      .from("cleaners")
      .select("id, company_id, is_company_owner")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (subjectType === "cleaner" && callerCleaner?.id !== subjectId) {
      // Tillåt VD att kolla teammedlemmar i samma company
      if (!callerCleaner?.is_company_owner) {
        return json(CORS, 403, { error: "not_authorized_for_subject" });
      }
      const { data: targetCheck } = await sbService
        .from("cleaners")
        .select("company_id")
        .eq("id", subjectId)
        .maybeSingle();
      if (targetCheck?.company_id !== callerCleaner.company_id) {
        return json(CORS, 403, { error: "subject_not_in_your_company" });
      }
    }
    if (subjectType === "company") {
      if (!callerCleaner?.is_company_owner || callerCleaner.company_id !== subjectId) {
        return json(CORS, 403, { error: "not_company_owner" });
      }
    }

    // ── Hämta status ──
    const [acceptance, currentBinding, signingRequired] = await Promise.all([
      checkAcceptanceStatus(sbService, subjectType, subjectId, avtalTypResolved),
      getCurrentBindingVersion(sbService, avtalTypResolved),
      isBankIdBindingRequired(sbService),
    ]);

    return json(CORS, 200, {
      ok: true,
      signing_required: signingRequired,
      acceptance,
      subject_type: subjectType,
      subject_id: subjectId,
      avtal_typ: avtalTypResolved,
      draft_url: currentBinding?.draft_url ?? null,
      pdf_url: currentBinding?.pdf_url ?? null,
    });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});
