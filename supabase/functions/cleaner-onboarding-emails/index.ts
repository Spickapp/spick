/**
 * cleaner-onboarding-emails — Sprint 1D
 *
 * 4-mail onboarding-drip för nya godkända cleaners. Skickas en åt gången
 * (max 1 mail/cleaner/dag) baserat på sekvens-state i
 * cleaners.onboarding_emails_sent (jsonb).
 *
 * SEKVENS (timing från day_1-stämpeln):
 *   day_1   — direkt vid första körning efter is_approved=true
 *   day_3   — 72h efter day_1
 *   week_1  — 168h efter day_1 (Sprint 1E marketing-kit pull-through)
 *   month_1 — 720h efter day_1
 *
 * SCHEMA-VERIFIERAT (curl mot prod 2026-04-26):
 *   - cleaners.is_approved (boolean) FINNS
 *   - cleaners.first_name + cleaners.email FINNS
 *   - cleaners.onboarding_emails_sent (jsonb) — adderas via migration 20260426330000
 *   - cleaners.approved_at osynligt för anon → använder day_1-stämpeln som ankare
 *
 * AUTH: CRON_SECRET via _shared/cron-auth.ts.
 *
 * SCHEMA: 1x/dag 07:00 UTC (~09:00 CEST) via .github/workflows/cleaner-onboarding-emails.yml
 *
 * REGLER: #28 SSOT (sendEmail + wrap från _shared/email.ts), #29 audit-först
 * (templates från docs/marketing/cleaner-onboarding-email-drip.md, Farhad-godkänd
 * 2026-04-26), #31 schema curl-verifierat INNAN kod.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, sendEmail, wrap, esc, log } from "../_shared/email.ts";
import { requireCronAuth } from "../_shared/cron-auth.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://spick.se";

const sb = createClient(SUPA_URL, SERVICE_KEY);

type SentMap = {
  day_1?: string | null;
  day_3?: string | null;
  week_1?: string | null;
  month_1?: string | null;
};

type Cleaner = {
  id: string;
  first_name: string | null;
  email: string | null;
  slug: string | null;
  onboarding_emails_sent: SentMap | null;
};

// ── Templates (Farhad-godkända 2026-04-26) ───────────────────
function tplDay1(c: Cleaner): { subject: string; html: string } {
  const name = esc(c.first_name || "städare");
  const slug = esc(c.slug || c.id);
  const profileUrl = `${SITE}/s/${encodeURIComponent(c.slug || c.id)}`;
  const content = `
<h2>Välkommen till Spick, ${name}!</h2>
<p>Din profil är godkänd och live. Du syns nu på <a href="${profileUrl}" style="color:#0F6E56;font-weight:600">spick.se/s/${slug}</a>.</p>
<p><strong>3 saker du gör NU för att få din första bokning inom 7 dagar:</strong></p>
<div class="card">
  <div class="row"><span class="lbl">1. Ladda upp profilbild</span><span class="val">+47% bokningar</span></div>
  <div class="row"><span class="lbl">2. Skriv 2-3 rader bio</span><span class="val">+23% förtroende</span></div>
  <div class="row"><span class="lbl">3. Markera ditt veckoschema</span><span class="val">Krav för matching</span></div>
</div>
<a href="${SITE}/stadare-dashboard.html" class="btn">Klar 3 stegen i dashboard →</a>
<p style="margin-top:24px">Frågor? Svara bara på det här mejlet — Farhad svarar personligen inom 24h.</p>
<p>Lycka till!<br>Farhad och Spick-teamet</p>`;
  return {
    subject: "Välkommen till Spick — så får du din första bokning",
    html: wrap(content),
  };
}

function tplDay3(c: Cleaner): { subject: string; html: string } {
  const name = esc(c.first_name || "städare");
  const content = `
<h2>Hej ${name}, så optimerar du din profil</h2>
<p>Du har varit på Spick i 3 dagar. Här är vad de bästa städarna gör annorlunda:</p>
<div class="card">
  <p style="margin:0 0 8px"><strong>Tip 1: Före/efter-foton</strong></p>
  <p style="margin:0">Ladda upp bilder från städningar du gjort. Profiler med jobb-foton får 3x fler klick.</p>
</div>
<div class="card">
  <p style="margin:0 0 8px"><strong>Tip 2: Personlig bio</strong></p>
  <p style="margin:0">Skriv VARFÖR du gillar att städa, inte bara vad du gör. Exempel: <em>"Jag älskar känslan av ett blanka kakelgolv. Jag är extra noggrann i kök och badrum eftersom det är där folk märker skillnaden mest."</em></p>
</div>
<div class="card">
  <p style="margin:0 0 8px"><strong>Tip 3: Sätt rätt pris</strong></p>
  <p style="margin:0">Branschmedelvärde för Hemstädning är 350-450 kr/h. Sätt 50 kr under medel första månaden för att samla recensioner snabbt.</p>
</div>
<a href="${SITE}/stadare-dashboard.html" class="btn">Optimera din profil →</a>
<p style="margin-top:24px">Vi finns för dig. Svara på detta mejl om något är otydligt.</p>
<p>Hälsningar,<br>Farhad</p>`;
  return {
    subject: `${name === "städare" ? "Hej!" : name + ","} 3 enkla tips för att få fler bokningar`,
    html: wrap(content),
  };
}

function tplWeek1(c: Cleaner): { subject: string; html: string } {
  const slug = esc(c.slug || c.id);
  const profileUrl = `${SITE}/s/${encodeURIComponent(c.slug || c.id)}`;
  const content = `
<h2>Du har en egen mini-hemsida på Spick — använd den!</h2>
<p>Visste du att du har en personlig länk som du kan dela var du vill?</p>
<div class="card" style="text-align:center">
  <p style="font-size:18px;margin:0"><strong><a href="${profileUrl}" style="color:#0F6E56">spick.se/s/${slug}</a></strong></p>
</div>
<p><strong>3 sätt att få bokningar genom din profil-länk:</strong></p>
<div class="card">
  <p style="margin:0 0 8px"><strong>1. Sociala medier</strong></p>
  <p style="margin:0">Lägg länken i Instagram-bio, Facebook-profil, TikTok-bio. Posta 1 story/vecka som leder till länken.</p>
</div>
<div class="card">
  <p style="margin:0 0 8px"><strong>2. Visitkort + dörrhängare</strong></p>
  <p style="margin:0">QR-koden i din dashboard (under "Min profil-länk") kan printas på visitkort. Dela ut i din lokal-area.</p>
</div>
<div class="card">
  <p style="margin:0 0 8px"><strong>3. Mejl-signatur</strong></p>
  <p style="margin:0">Lägg till "Boka mig på Spick: spick.se/s/${slug}" i din mejl-signatur.</p>
</div>
<p><strong>Varje bokning du driver in via din länk = du får 88% av jobb-priset.</strong> Spick tar bara 12%.</p>
<a href="${SITE}/stadare-dashboard.html#tab-home" class="btn">Generera QR-kod →</a>
<p style="margin-top:24px">Bästa städarna får 5-10 nya kunder per månad bara genom egna kanaler.</p>
<p>/Farhad</p>`;
  return {
    subject: "Din egen profil-länk — så marknadsför du dig själv",
    html: wrap(content),
  };
}

function tplMonth1(c: Cleaner): { subject: string; html: string } {
  const name = esc(c.first_name || "städare");
  const content = `
<h2>30 dagar på Spick — dags att bygga betygshistorik</h2>
<p>Hej ${name}! Du har varit med oss en månad. Bra jobbat så här långt!</p>
<p>Recensioner är AVGÖRANDE för fler bokningar. En cleaner med 10+ betyg får 4x fler bokningar än en utan.</p>
<p><strong>3 saker som garanterar 5⭐:</strong></p>
<div class="card">
  <p style="margin:0 0 8px"><strong>1. Kommunicera FÖRE städningen</strong></p>
  <p style="margin:0">Skicka SMS dagen innan: "Hej! Jag kommer kl 10 imorgon. Något särskilt jag ska tänka på?" Bara att fråga visar professionalism.</p>
</div>
<div class="card">
  <p style="margin:0 0 8px"><strong>2. Foto efter avslutad städning</strong></p>
  <p style="margin:0">Skicka kund 2-3 foton av "after"-resultatet. Det skapar wow-effekt + bevis vid eventuell tvist.</p>
</div>
<div class="card">
  <p style="margin:0 0 8px"><strong>3. Be om betyg direkt på plats</strong></p>
  <p style="margin:0">När städningen är klar: "Tack för att du valde mig! Om allt såg bra ut, skulle du kunna betygsätta mig på Spick? Det hjälper mig enormt." 80% säger ja om du frågar då.</p>
</div>
<p><strong>Bonus:</strong> Spick skickar automatiskt påminnelse till kunden 2h efter städning (Sprint 5 — live). Men din direkta fråga gör 5x mer skillnad.</p>
<p>Vi tror på dig.<br>Farhad och Spick-teamet</p>`;
  return {
    subject: `${name === "städare" ? "Hej!" : name + ","} här är hur du får fler 5-stjärniga betyg`,
    html: wrap(content),
  };
}

// ── Cron-handler ──────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = requireCronAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Hämta alla approved cleaners med email
  const { data: cleaners, error } = await sb
    .from("cleaners")
    .select("id, first_name, email, slug, onboarding_emails_sent")
    .eq("is_approved", true)
    .not("email", "is", null);

  if (error) {
    log("error", "cleaner-onboarding-emails", "fetch cleaners failed", { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  const stats = { processed: 0, day_1: 0, day_3: 0, week_1: 0, month_1: 0, errors: 0 };

  for (const c of (cleaners || []) as Cleaner[]) {
    if (!c.email) continue;
    const sent: SentMap = c.onboarding_emails_sent || {};
    let nextStage: "day_1" | "day_3" | "week_1" | "month_1" | null = null;
    let template: ReturnType<typeof tplDay1> | null = null;

    if (!sent.day_1) {
      nextStage = "day_1";
      template = tplDay1(c);
    } else {
      const day1Time = new Date(sent.day_1).getTime();
      const hoursSinceDay1 = (now.getTime() - day1Time) / 3600000;

      if (!sent.day_3 && hoursSinceDay1 >= 72) {
        nextStage = "day_3";
        template = tplDay3(c);
      } else if (!sent.week_1 && hoursSinceDay1 >= 168) {
        nextStage = "week_1";
        template = tplWeek1(c);
      } else if (!sent.month_1 && hoursSinceDay1 >= 720) {
        nextStage = "month_1";
        template = tplMonth1(c);
      }
    }

    if (!nextStage || !template) continue; // inget att skicka denna körning

    const result = await sendEmail(c.email, template.subject, template.html);
    if (!result.ok) {
      stats.errors++;
      log("error", "cleaner-onboarding-emails", "sendEmail failed", {
        cleaner_id: c.id,
        stage: nextStage,
        error: result.error,
      });
      continue;
    }

    sent[nextStage] = now.toISOString();
    const { error: updErr } = await sb
      .from("cleaners")
      .update({ onboarding_emails_sent: sent })
      .eq("id", c.id);

    if (updErr) {
      stats.errors++;
      log("error", "cleaner-onboarding-emails", "update sent-state failed", {
        cleaner_id: c.id,
        stage: nextStage,
        error: updErr.message,
      });
      continue;
    }

    stats[nextStage]++;
    stats.processed++;
  }

  log("info", "cleaner-onboarding-emails", "done", stats as unknown as Record<string, unknown>);

  return new Response(JSON.stringify({ ok: true, stats }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
