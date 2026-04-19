// ═══════════════════════════════════════════════════════════════
// SPICK – poll-stripe-onboarding-status (Sprint B Dag 6)
//
// Safety-net cron: fall webhook stripe-connect-webhook missar 
// ett account.updated-event (vår EF var nere, Stripe timeout, etc),
// denna cron pollar Stripe var 30:e min och synkar DB.
//
// Körs av pg_cron, autentiseras via CRON_SECRET eller service_role_key.
//
// Scope: cleaners med stripe_account_id NOT NULL och status != complete
// som uppdaterats senast för mer än 30 min sedan.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const sb = createClient(SUPA_URL, SERVICE_KEY);

function log(level: string, msg: string, extra: Record<string,unknown> = {}) {
  console.log(JSON.stringify({ level, fn: "poll-stripe-onboarding-status", msg, ...extra, ts: new Date().toISOString() }));
}

// ── Hämta Stripe-account-status ──
async function fetchStripeAccount(accountId: string): Promise<{
  details_submitted: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements?: { currently_due?: string[]; past_due?: string[]; disabled_reason?: string | null };
} | null> {
  try {
    const res = await fetch(`https://api.stripe.com/v1/accounts/${accountId}`, {
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        "Stripe-Version": "2023-10-16",
      },
    });
    if (!res.ok) {
      log("warn", "Stripe API returned non-200", { account_id: accountId, status: res.status });
      return null;
    }
    return await res.json();
  } catch (e) {
    log("warn", "Stripe fetch exception", { account_id: accountId, error: (e as Error).message });
    return null;
  }
}

// ── Bestäm ny status baserat på Stripe-data ──
function deriveStatus(account: {
  details_submitted?: boolean;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: { currently_due?: string[]; past_due?: string[]; disabled_reason?: string | null };
}): string {
  if (account.details_submitted && account.charges_enabled && account.payouts_enabled) {
    return "complete";
  }
  if ((account.requirements?.currently_due?.length ?? 0) > 0 || 
      (account.requirements?.past_due?.length ?? 0) > 0) {
    return "requirements_pending";
  }
  if (account.requirements?.disabled_reason) {
    return "disabled";
  }
  return "pending";
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
    // ── Hämta kandidater: cleaners med stripe_account_id men inte complete ──
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    
    const { data: candidates, error } = await sb
      .from("cleaners")
      .select("id, full_name, stripe_account_id, stripe_onboarding_status, is_company_owner, company_id, updated_at")
      .not("stripe_account_id", "is", null)
      .not("stripe_onboarding_status", "in", '(complete,deauthorized,rejected)')
      .lt("updated_at", thirtyMinutesAgo)
      .limit(100);
    
    if (error) {
      log("error", "Failed to fetch candidates", { error: error.message });
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    
    if (!candidates || candidates.length === 0) {
      log("info", "No candidates to poll");
      return new Response(JSON.stringify({ ok: true, checked: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    
    log("info", "Polling candidates", { count: candidates.length });
    
    let updated = 0;
    let unchanged = 0;
    let errors = 0;
    const updatedIds: string[] = [];
    
    // ── Iterera kandidater ──
    for (const cleaner of candidates) {
      const account = await fetchStripeAccount(cleaner.stripe_account_id!);
      
      if (!account) {
        errors++;
        continue;
      }
      
      const newStatus = deriveStatus(account);
      
      if (newStatus === cleaner.stripe_onboarding_status) {
        unchanged++;
        // Touch updated_at så vi inte plockar upp samma rad snart igen
        await sb.from("cleaners")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", cleaner.id);
        continue;
      }
      
      // ── Uppdatera cleaner ──
      const { error: updateErr } = await sb
        .from("cleaners")
        .update({
          stripe_onboarding_status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cleaner.id);
      
      if (updateErr) {
        log("error", "Update failed", { cleaner_id: cleaner.id, error: updateErr.message });
        errors++;
        continue;
      }
      
      // ── Synka company (om VD blev complete) ──
      if (newStatus === "complete" && cleaner.is_company_owner && cleaner.company_id) {
        await sb
          .from("companies")
          .update({
            stripe_account_id: cleaner.stripe_account_id,
            onboarding_status: "pending_team",  // redo för admin-approval eller team-invites
            updated_at: new Date().toISOString(),
          })
          .eq("id", cleaner.company_id);
      }
      
      updated++;
      updatedIds.push(cleaner.id);
      log("info", "Status synced", {
        cleaner_id: cleaner.id,
        from: cleaner.stripe_onboarding_status,
        to: newStatus,
      });
    }
    
    log("info", "Cron run completed", { 
      checked: candidates.length, 
      updated, 
      unchanged, 
      errors,
    });
    
    return new Response(
      JSON.stringify({
        ok: true,
        checked: candidates.length,
        updated,
        unchanged,
        errors,
        updated_ids: updatedIds,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
    
  } catch (err) {
    log("error", "Unhandled exception", { error: (err as Error).message });
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
