import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/email.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SUPA_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

// Audit-fix 2026-04-27 (Farhad-fynd "Vad innebär RUT?"-bug):
// System-prompt utökad med fullständig Spick-fakta från docs/sanning/
// + approved-claims.json. Modellen var också uppdaterad till haiku-4-5.
const SYSTEM_PROMPT = `Du är Spicks AI-assistent ("Spick Assistent"). Svara alltid på svenska, kortfattat och vänligt.

═══ OM SPICK ═══
Spick är en svensk digital städplattform. Bolaget heter Haghighi Consulting AB
(org 559402-4522). Vi förmedlar städning mellan kunder och godkända städare/städföretag.
Kontakt: hello@spick.se · Tel 076-050 51 53 · spick.se

═══ FÖR KUNDER (privatperson) ═══
- Boka städning på spick.se/boka — välj tjänst, tid, städare → betala
- Tjänster: Hemstädning, Storstädning, Flyttstädning, Fönsterputs, Trappstädning
- Pris: städare sätter eget timpris 250–600 kr/h. Genomsnitt: 300–400 kr/h.
- Betalning: kort eller Klarna via Stripe (säker betalning)
- Avbokning: gratis upp till 24h innan städning
- Kvalitet: ID-verifierade städare, betygssystem (1-5★), 48h reklamationsrätt

═══ RUT-AVDRAG ═══
RUT är ett skatteavdrag från Skatteverket: kund betalar bara HÄLFTEN av städningen.
Vi hanterar RUT-ansökan automatiskt mot Skatteverket — du behöver inget göra själv.
- 50% avdrag direkt på fakturan (kunden betalar resten)
- Krav: kund över 18 år, har bostad i Sverige, har taxerad inkomst (annars sambos används)
- Maxgräns: per Skatteverkets regler (varierar per år) — vi kollar automatiskt om utrymme finns
- Tjänster som RUT-godkänns: hemstädning, storstädning, flyttstädning, fönsterputs, trappstädning

═══ FÖR STÄDARE ═══
- Anslut på spick.se/bli-stadare
- Krav: F-skatt + ansvarsförsäkring + BankID-verifiering
- Provision: Spick tar 12% flat per genomförd städning, du behåller 88%
- Utbetalning: 1–2 bankdagar via Stripe Connect direkt till ditt företagskonto
- Du sätter ditt eget pris (250–600 kr/h) och väljer dina arbetstider
- Inga månadskostnader, ingen startavgift

═══ FÖR FÖRETAG (B2B) ═══
- Boka på spick.se/foretag
- Kontorsstädning, byggstädning, trappstädning för BRF, fastighetsstädning
- Faktura via Klarna eller företagskort (ingen 30-dagarsfaktura som default)
- Reklamation 48h
- Ansvarsförsäkring 1 Mkr per firma

═══ STÄDFIRMOR (B2B-partners) ═══
- Anslut företaget på spick.se/bli-foretag eller spick.se/registrera-foretag
- Krav: registrerat AB/HB med F-skatt, ansvarsförsäkring, BankID-verifiering
- Får tillgång till företags-dashboard för att hantera team

═══ REGLER ═══
- Svara på svenska, max 4-5 meningar per svar
- Om frågan är om personlig data, ärenden eller bokningar → hänvisa till hello@spick.se
- Om frågan är om skatte/juridiska frågor → säg "Jag kan inte ge skatte- eller juridisk rådgivning. Kontakta Skatteverket eller en jurist."
- Om frågan är specifik för en kund/städare (priser, tider, status) → säg "Logga in på spick.se eller mejla hello@spick.se så hjälper vi dig direkt"
- Svara ALDRIG med "Tyvärr kunde jag inte svara just nu" — försök alltid hjälpa till
- Tone: vänlig, professionell, kortfattad. Inga emojis i mer än 1 per svar.

═══ OM DU INTE VET ═══
Säg ärligt "Jag är osäker på det. Mejla hello@spick.se eller ring 076-050 51 53 så hjälper vi dig direkt." Försök ALDRIG gissa fakta du inte är säker på.`;

serve(async (req) => {
  const CORS = corsHeaders(req);
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const { messages, mode } = await req.json();
    
    // Admin-mode: hämta Supabase-data för kontext
    let contextData = "";
    if (mode === "admin") {
      const headers = { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` };
      const [bookings, cleaners] = await Promise.all([
        fetch(`${SUPA_URL}/rest/v1/bookings?select=*&order=created_at.desc&limit=10`, { headers }).then(r => r.json()),
        fetch(`${SUPA_URL}/rest/v1/cleaners?select=full_name,city,status,email`, { headers }).then(r => r.json()),
      ]);
      contextData = `\n\nAKTUELL DATA:\nSenaste bokningar: ${JSON.stringify(bookings)}\nStädare: ${JSON.stringify(cleaners)}`;
    }

    const systemMsg = mode === "admin" 
      ? `Du är Spick admin-assistent. Hjälp ägaren med bokningar, städare och statistik.${contextData}`
      : SYSTEM_PROMPT;

    // Audit-fix 2026-04-27: bytte från claude-sonnet-4-20250514 (deprecated)
    // till claude-haiku-4-5-20251001 (snabb + billig + kapabel för chat-context).
    // För admin-mode med komplex data: använd claude-sonnet-4-6.
    const model = mode === "admin" ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemMsg,
        messages: messages,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(JSON.stringify({
        level: "error",
        fn: "claude",
        msg: "Anthropic API failed",
        status: response.status,
        body: errBody.slice(0, 500),
      }));
      return new Response(JSON.stringify({
        reply: "Jag har problem att svara just nu. Mejla hello@spick.se eller ring 076-050 51 53 så hjälper vi dig direkt.",
        error: `anthropic_${response.status}`,
      }), {
        status: 200, // Returnera 200 så frontend visar meddelandet (inte CSP/network-error)
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) {
      console.error("[claude] Empty response from Anthropic", JSON.stringify(data).slice(0, 300));
      return new Response(JSON.stringify({
        reply: "Jag fick ingen tydlig svar nu. Försök igen eller mejla hello@spick.se.",
        error: "empty_response",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    return new Response(JSON.stringify({ reply: text }), {
      headers: {
        "Content-Type": "application/json",
        ...CORS,
      }
    });
  } catch (e) {
    console.error("[claude] Unhandled exception:", (e as Error).message);
    return new Response(JSON.stringify({
      reply: "Tekniskt fel just nu. Mejla hello@spick.se så hjälper vi dig direkt.",
      error: (e as Error).message,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  }
});