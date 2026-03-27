/**
 * email-inbound – tar emot alla mail till hello@spick.se via Resend webhook
 * 
 * Flöde:
 * 1. Resend skickar webhook med parsed email
 * 2. AI kategoriserar och sammanfattar
 * 3. Auto-svar skickas om möjligt
 * 4. Sparas i DB för admin-inkorgen
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL  = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY")!;
const RESEND    = Deno.env.get("RESEND_API_KEY")!;

const supabase = createClient(SUPA_URL, SUPA_KEY);

// ─── Auto-svar per kategori ───────────────────────────────────────────────
const AUTO_REPLIES: Record<string, { subject: string; body: string }> = {
  bokning: {
    subject: "Tack för din fråga om bokning! 🌿",
    body: `<div style="font-family:sans-serif;max-width:580px">
<h2 style="color:#0F6E56">Tack för att du hör av dig!</h2>
<p>Vi har tagit emot ditt meddelande och återkommer inom <strong>2 timmar</strong>.</p>
<p>Vill du boka direkt? Det går snabbast via:</p>
<a href="https://spick.se/boka.html" style="background:#0F6E56;color:white;padding:12px 24px;border-radius:24px;text-decoration:none;display:inline-block;margin:8px 0">Boka städning nu →</a>
<p style="color:#6B6960;font-size:13px;margin-top:24px">Spick AB · hello@spick.se · spick.se</p>
</div>`,
  },
  fråga: {
    subject: "Vi återkommer snart! 👋",
    body: `<div style="font-family:sans-serif;max-width:580px">
<h2 style="color:#0F6E56">Tack för din fråga!</h2>
<p>Vi har tagit emot ditt meddelande och svarar normalt inom <strong>2 timmar</strong> på vardagar.</p>
<p>Hittar du svaret på din fråga i vår FAQ?</p>
<a href="https://spick.se/faq.html" style="background:#0F6E56;color:white;padding:12px 24px;border-radius:24px;text-decoration:none;display:inline-block;margin:8px 0">Se vanliga frågor →</a>
<p style="color:#6B6960;font-size:13px;margin-top:24px">Spick AB · hello@spick.se · spick.se</p>
</div>`,
  },
  klago: {
    subject: "Vi tar ditt klagomål på allvar 🙏",
    body: `<div style="font-family:sans-serif;max-width:580px">
<h2 style="color:#0F6E56">Tack för att du hör av dig</h2>
<p>Vi är ledsna att du inte är nöjd och tar detta på största allvar. En av oss återkommer till dig <strong>inom 1 timme</strong>.</p>
<p>Vi erbjuder alltid <strong>gratis omstädning</strong> om städningen inte levde upp till förväntningarna.</p>
<p style="color:#6B6960;font-size:13px;margin-top:24px">Spick AB · hello@spick.se · spick.se</p>
</div>`,
  },
  avboka: {
    subject: "Avbokning bekräftad ✓",
    body: `<div style="font-family:sans-serif;max-width:580px">
<h2 style="color:#0F6E56">Vi har tagit emot din avbokning</h2>
<p>En av oss bekräftar avbokningen och eventuell återbetalning inom <strong>2 timmar</strong>.</p>
<p>Kom ihåg: Avbokning är gratis upp till 24h innan städning.</p>
<p>Vill du boka om till ett annat datum?</p>
<a href="https://spick.se/boka.html" style="background:#0F6E56;color:white;padding:12px 24px;border-radius:24px;text-decoration:none;display:inline-block;margin:8px 0">Boka nytt datum →</a>
<p style="color:#6B6960;font-size:13px;margin-top:24px">Spick AB · hello@spick.se · spick.se</p>
</div>`,
  },
  ansökan: {
    subject: "Tack för din ansökan som städare! 🧹",
    body: `<div style="font-family:sans-serif;max-width:580px">
<h2 style="color:#0F6E56">Tack för ditt intresse!</h2>
<p>Vi har tagit emot ditt meddelande. Det snabbaste sättet att ansöka är via vårt formulär:</p>
<a href="https://spick.se/rekrytera.html" style="background:#0F6E56;color:white;padding:12px 24px;border-radius:24px;text-decoration:none;display:inline-block;margin:8px 0">Ansök som städare →</a>
<p>Vi granskar alla ansökningar och hör av oss inom <strong>2 arbetsdagar</strong>.</p>
<p style="color:#6B6960;font-size:13px;margin-top:24px">Spick AB · hello@spick.se · spick.se</p>
</div>`,
  },
};

// ─── AI-kategorisering ────────────────────────────────────────────────────
async function categorizeWithAI(from: string, subject: string, body: string) {
  const prompt = `Du är assistent för Spick – en svensk städmarknadsplats.

Kategorisera detta inkommande mail och svara BARA med JSON (inget annat):

Från: ${from}
Ämne: ${subject}
Text: ${body.slice(0, 800)}

Svara med JSON:
{
  "category": "bokning|klago|avboka|ansökan|fråga|spam|partner|system",
  "priority": "hög|normal|låg",
  "summary": "En mening som sammanfattar vad avsändaren vill",
  "auto_reply": true|false,
  "reason": "Varför denna kategori"
}

Regler:
- klago = missnöjd kund, klagomål, inte nöjd, städaren kom inte → ALLTID hög prioritet
- bokning = vill boka, fråga om pris, tillgänglighet
- avboka = vill avboka eller boka om
- ansökan = vill bli städare
- fråga = generell fråga
- partner = företag som vill samarbeta → låg prioritet
- system = automatiskt mail, noreply, bekräftelse → låg + auto_reply=false
- spam = reklam, irrelevant → låg + auto_reply=false
- auto_reply=true om standardsvar räcker, false om ärendet kräver personlig hantering`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("AI-fel:", e);
    return { category: "fråga", priority: "normal", summary: subject, auto_reply: true };
  }
}

// ─── Skicka mail via Resend ───────────────────────────────────────────────
async function sendReply(to: string, toName: string, subject: string, html: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND}`,
    },
    body: JSON.stringify({
      from: "Spick <hello@spick.se>",
      to: toName ? `${toName} <${to}>` : to,
      subject,
      html,
    }),
  });
}

// ─── Huvudfunktion ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const payload = await req.json();
    console.log("📧 Inkommande mail:", JSON.stringify(payload).slice(0, 200));

    // Resend inbound format
    const fromEmail = payload.from || payload.sender || "";
    const fromName  = payload.from_name || payload.sender_name || "";
    const subject   = payload.subject || "(inget ämne)";
    const bodyText  = payload.text || payload.plain || "";
    const bodyHtml  = payload.html || "";
    const resendId  = payload.id || payload.message_id || null;
    const replyTo   = payload.reply_to || fromEmail;

    // Skippa egna systemmail
    if (fromEmail.includes("@spick.se") || fromEmail.includes("noreply")) {
      return new Response(JSON.stringify({ ok: true, skipped: "own mail" }), { status: 200 });
    }

    // AI-kategorisering
    const ai = await categorizeWithAI(fromEmail, subject, bodyText);
    console.log("🤖 AI:", JSON.stringify(ai));

    // Spara i DB
    const { data: saved, error } = await supabase
      .from("emails")
      .insert({
        from_email:  fromEmail,
        from_name:   fromName,
        reply_to:    replyTo,
        subject,
        body_text:   bodyText.slice(0, 5000),
        body_html:   bodyHtml.slice(0, 10000),
        category:    ai.category || "fråga",
        priority:    ai.priority || "normal",
        ai_summary:  ai.summary || subject,
        status:      "ny",
        resend_id:   resendId,
        raw_headers: payload,
      })
      .select()
      .single();

    if (error) {
      console.error("DB-fel:", error);
      // Kör vidare även om DB misslyckas
    }

    // Skicka auto-svar om möjligt
    let autoReplied = false;
    if (ai.auto_reply && AUTO_REPLIES[ai.category]) {
      const reply = AUTO_REPLIES[ai.category];
      await sendReply(replyTo, fromName, reply.subject, reply.body);
      autoReplied = true;

      // Uppdatera status i DB
      if (saved?.id) {
        await supabase.from("emails").update({
          auto_replied: true,
          ai_reply:     reply.subject,
          replied_at:   new Date().toISOString(),
          status:       "auto-besvarad",
        }).eq("id", saved.id);
      }
      console.log(`✅ Auto-svar skickat till ${replyTo}: ${reply.subject}`);
    }

    // Notifiera admin om hög prioritet
    if (ai.priority === "hög") {
      await fetch(`${SUPA_URL}/functions/v1/notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPA_KEY}`,
        },
        body: JSON.stringify({
          type: "admin_alert",
          record: {
            subject: `🚨 Hög prioritet: ${subject}`,
            message: `Från: ${fromEmail}\n${ai.summary}`,
          },
        }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({ ok: true, category: ai.category, auto_replied: autoReplied }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("Fel:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
