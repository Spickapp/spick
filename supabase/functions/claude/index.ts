import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SUPA_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const SYSTEM_PROMPT = `Du är Spicks AI-assistent. Spick är en städplattform i Sverige.

FAKTA OM SPICK:
- Pris: 350 kr/h, typisk städning 3h = 1050 kr
- RUT-avdrag: 50% rabatt för privatpersoner (max 75 000 kr/år)
- Aktiva städare i Stockholm, Göteborg, Malmö och 17 andra städer
- Bokningar via spick.se/boka
- Kontakt: hello@spick.se

REGLER:
- Svara alltid på svenska
- Var hjälpsam, kortfattad och professionell
- Om du inte vet svaret, hänvisa till hello@spick.se
- Uppmuntra kunden att boka på spick.se/boka`;

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "https://spick.se",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      }
    });
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

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemMsg,
        messages: messages,
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || "Tyvärr kunde jag inte svara just nu.";

    return new Response(JSON.stringify({ reply: text }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "https://spick.se",
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "https://spick.se" }
    });
  }
});