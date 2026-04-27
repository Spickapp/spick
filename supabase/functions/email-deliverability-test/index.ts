// ═══════════════════════════════════════════════════════════════
// SPICK – email-deliverability-test (manuellt-triggad / monthly cron)
// ═══════════════════════════════════════════════════════════════
//
// SYFTE:
//   Verifiera att Resend-leverans + DKIM/SPF/DMARC fungerar +
//   att vårt content inte triggar spam-filter.
//
//   Skickar ett representativt transaktionsmail till mail-tester.com
//   (eller annan recipient) och returnerar Resend message-id för
//   tracking. mail-tester.com tilldelar score 0-10 baserat på
//   SpamAssassin + auth-headers.
//
// PATTERN (#28 SSOT):
//   Wrap:ar bara existerande sendEmail() från _shared/email.ts.
//   Ingen egen Resend-call — om Resend-API ändras uppdaterar vi
//   _shared/email.ts, inte denna.
//
// AUTH:
//   Kräver Bearer CRON_SECRET via _shared/cron-auth.ts. Annars
//   skulle vem som helst kunna spam:a vår Resend-quota.
//
// ANROP:
//   POST /functions/v1/email-deliverability-test
//     Authorization: Bearer <CRON_SECRET>
//     Body: { "to_email"?: "...", "subject"?: "...", "score_url"?: "..." }
//
//   to_email default: env EMAIL_TEST_RECIPIENT
//                  → fallback: mail-tester@srv1.mail-tester.com
//
//   Returnerar:
//     { ok: true, attempted_at, resend_id, to, score_check_url }
//     { ok: false, attempted_at, error, status }
//
// MAIL-TESTER.COM FLOW:
//   1. Besök https://www.mail-tester.com — får unik addr (10-tecken
//      random-suffix), t.ex. test-abc123xyz9@srv1.mail-tester.com
//   2. Sätt EMAIL_TEST_RECIPIENT=<den addressen> som Supabase secret
//      (eller skicka in via body.to_email vid manuell test)
//   3. Vänta ~30s, besök score-URL för att se SpamAssassin-resultat
//
//   OBS: Varje mail-tester-adress kan ENDAST ta emot 1 mail.
//   För återkommande tester behöver vi cron:a generera ny adress —
//   alternativt använda Postmark Spam Check eller GlockApps.
//   I monthly cron skickar vi till EMAIL_TEST_RECIPIENT som Farhad
//   manuellt rotates när han vill köra audit.
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { sendEmail, wrap, card, corsHeaders, esc } from "../_shared/email.ts";
import { requireCronAuth } from "../_shared/cron-auth.ts";

const DEFAULT_RECIPIENT =
  Deno.env.get("EMAIL_TEST_RECIPIENT") ||
  "mail-tester@srv1.mail-tester.com";

/**
 * Bygg representativt test-mail som speglar vårt vanliga
 * bekräftelse-format (header, card, footer). Detta är vad
 * SpamAssassin ska bedöma — inte ett "Hello World".
 */
function buildTestEmail(timestamp: string): { subject: string; html: string } {
  const subject = `Spick e-postlevereans-test ${timestamp}`;

  const content = `
    <h2>Bekräftelse — Test-mail</h2>
    <p>Detta är ett automatiskt test-mail från Spick för att verifiera
    e-postlevereans (DKIM/SPF/DMARC + spam-score). Du behöver inte agera.</p>
    ${card([
      ["Tid", esc(timestamp)],
      ["Avsändare", "hello@spick.se via Resend"],
      ["Test-typ", "Deliverability audit"],
      ["Org-nr", "559402-4522"],
    ])}
    <p>Om du ser detta i din inkorg så fungerar leveransen. Om mailet
    hamnade i skräp/spam — kontrollera DKIM-signering på Resend-dashboard
    och DMARC-policy på spick.se DNS.</p>
    <p style="margin-top:24px">
      <a class="btn" href="https://spick.se">Besök Spick</a>
    </p>
  `;

  return { subject, html: wrap(content) };
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  // ── AUTH: kräv CRON_SECRET ───────────────────────────────
  const auth = requireCronAuth(req, CORS);
  if (!auth.ok) return auth.response!;

  const attempted_at = new Date().toISOString();

  // ── Parsa body (alla fält optional) ──────────────────────
  let to_email: string = DEFAULT_RECIPIENT;
  let custom_subject: string | undefined;
  let score_check_url: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.to_email && typeof body.to_email === "string") {
      to_email = body.to_email.trim();
    }
    if (body.subject && typeof body.subject === "string") {
      custom_subject = body.subject;
    }
    if (body.score_url && typeof body.score_url === "string") {
      score_check_url = body.score_url;
    }
  } catch (_) {
    // tom body OK — använd defaults
  }

  // ── Validera recipient ───────────────────────────────────
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to_email)) {
    return new Response(
      JSON.stringify({
        ok: false,
        attempted_at,
        error: "invalid_recipient",
        details: `to_email "${to_email}" är inte en giltig e-postadress`,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS },
      },
    );
  }

  // ── Bygg + skicka mail ───────────────────────────────────
  const { subject: defaultSubject, html } = buildTestEmail(attempted_at);
  const subject = custom_subject || defaultSubject;

  console.log(
    `[email-deliverability-test] sending to=${to_email} subject="${subject}"`,
  );

  const result = await sendEmail(to_email, subject, html);

  if (!result.ok) {
    console.error(
      `[email-deliverability-test] FAIL to=${to_email} error=${result.error}`,
    );
    return new Response(
      JSON.stringify({
        ok: false,
        attempted_at,
        to: to_email,
        error: result.error || "unknown_resend_error",
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", ...CORS },
      },
    );
  }

  // ── Success ──────────────────────────────────────────────
  // Bygg score-check-URL för mail-tester.com (om recipient matchar pattern)
  let inferredScoreUrl: string | undefined;
  const mailTesterMatch = to_email.match(
    /^([a-z0-9-]+)@srv\d+\.mail-tester\.com$/i,
  );
  if (mailTesterMatch) {
    inferredScoreUrl = `https://www.mail-tester.com/${mailTesterMatch[1]}`;
  }

  console.log(
    `[email-deliverability-test] OK to=${to_email} resend_id=${result.id}`,
  );

  return new Response(
    JSON.stringify({
      ok: true,
      attempted_at,
      to: to_email,
      resend_id: result.id,
      subject,
      score_check_url: score_check_url || inferredScoreUrl || null,
      note: inferredScoreUrl
        ? `Vänta ~30s, besök ${inferredScoreUrl} för SpamAssassin-score (0-10).`
        : "Manuell verifiering — kolla att mailet kom in i inbox (inte spam).",
    }),
    {
      headers: { "Content-Type": "application/json", ...CORS },
    },
  );
});
