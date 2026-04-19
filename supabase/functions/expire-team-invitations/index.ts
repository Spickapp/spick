// ═══════════════════════════════════════════════════════════════
// SPICK – expire-team-invitations (Sprint B Dag 6)
//
// Dagligt cron-jobb (00:00) som markerar cleaner_applications-rader 
// med status='invited' som 'expired' om de är äldre än 7 dagar.
//
// Detta förhindrar:
// - Stale invites som fortfarande syns i VD:s dashboard
// - Magic-links som redan gått ut tekniskt men applikations-
//   statusen säger fortfarande 'invited'
//
// OBS: magic-link TTL hanteras separat av public-auth-exchange. 
// Denna EF uppdaterar bara cleaner_applications-statusen.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { sendEmail, wrap } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const sb = createClient(SUPA_URL, SERVICE_KEY);

function log(level: string, msg: string, extra: Record<string,unknown> = {}) {
  console.log(JSON.stringify({ level, fn: "expire-team-invitations", msg, ...extra, ts: new Date().toISOString() }));
}

Deno.serve(async (req) => {
  // ── Auth ──
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const validCron = CRON_SECRET && token === CRON_SECRET;
  const validService = SERVICE_KEY && token === SERVICE_KEY;
  
  if (!validCron && !validService) {
    log("warn", "Unauthorized cron call");
    return new Response("Unauthorized", { status: 401 });
  }
  
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    // ── Hämta expirande invites (för logging + VD-notis) ──
    const { data: toExpire, error: fetchErr } = await sb
      .from("cleaner_applications")
      .select("id, full_name, invited_phone, invited_by_company_id, created_at")
      .eq("status", "invited")
      .lt("created_at", sevenDaysAgo)
      .limit(500);
    
    if (fetchErr) {
      log("error", "Fetch failed", { error: fetchErr.message });
      return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
    }
    
    if (!toExpire || toExpire.length === 0) {
      log("info", "No invites to expire");
      return new Response(JSON.stringify({ ok: true, expired: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    
    log("info", "Expiring invites", { count: toExpire.length });
    
    // ── Gruppera per företag (för VD-summary-email) ──
    const byCompany = new Map<string, { count: number; names: string[] }>();
    for (const inv of toExpire) {
      const cid = inv.invited_by_company_id;
      if (!cid) continue;
      const entry = byCompany.get(cid) ?? { count: 0, names: [] };
      entry.count++;
      if (entry.names.length < 5) entry.names.push(inv.full_name);
      byCompany.set(cid, entry);
    }
    
    // ── Uppdatera alla i en batch ──
    const ids = toExpire.map(i => i.id);
    const { error: updateErr } = await sb
      .from("cleaner_applications")
      .update({
        status: "expired",
        onboarding_phase: "expired",
      })
      .in("id", ids);
    
    if (updateErr) {
      log("error", "Bulk update failed", { error: updateErr.message });
      return new Response(JSON.stringify({ error: updateErr.message }), { status: 500 });
    }
    
    // ── Skicka VD-notis-email (en per företag) ──
    let emailsSent = 0;
    let emailsFailed = 0;
    
    for (const [companyId, data] of byCompany.entries()) {
      try {
        const { data: company } = await sb
          .from("companies")
          .select("id, name, owner_cleaner_id")
          .eq("id", companyId)
          .maybeSingle();
        
        if (!company?.owner_cleaner_id) continue;
        
        const { data: vd } = await sb
          .from("cleaners")
          .select("email, first_name, full_name")
          .eq("id", company.owner_cleaner_id)
          .maybeSingle();
        
        if (!vd?.email) continue;
        
        const nameList = data.names.slice(0, 3).map(n => `<li>${n}</li>`).join("");
        const moreText = data.count > 3 ? `<li>… och ${data.count - 3} till</li>` : "";
        
        await sendEmail(
          vd.email,
          `${data.count} teaminbjudan har gått ut — Spick`,
          wrap(`
            <h2>Inbjudningar har gått ut</h2>
            <p>Hej ${vd.first_name || vd.full_name},</p>
            <p>${data.count} av dina teaminbjudningar för <strong>${company.name}</strong> har gått ut (inte accepterats inom 7 dagar):</p>
            <ul>${nameList}${moreText}</ul>
            <p>Vill du bjuda in dem igen? Öppna företagsdashboarden:</p>
            <p><a href="https://spick.se/foretag-dashboard.html" style="display:inline-block;padding:12px 24px;background:#0F6E56;color:white;text-decoration:none;border-radius:10px;font-weight:600">Skicka nya inbjudningar →</a></p>
          `)
        );
        emailsSent++;
      } catch (e) {
        log("warn", "VD notification failed", { 
          company_id: companyId, 
          error: (e as Error).message 
        });
        emailsFailed++;
      }
    }
    
    log("info", "Cron completed", {
      expired: toExpire.length,
      companies_notified: emailsSent,
      email_failures: emailsFailed,
    });
    
    return new Response(
      JSON.stringify({
        ok: true,
        expired: toExpire.length,
        companies_notified: emailsSent,
        email_failures: emailsFailed,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
    
  } catch (err) {
    log("error", "Unhandled exception", { error: (err as Error).message });
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
