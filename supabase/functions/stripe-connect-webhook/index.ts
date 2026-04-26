// ═══════════════════════════════════════════════════════════════
// SPICK – stripe-connect-webhook (Sprint B Dag 1)
//
// Lyssnar på Stripe Connect webhook-events:
// - account.updated            → detektera completion av onboarding
// - account.application.deauthorized → cleaner har kopplat ur Stripe
//
// Uppdaterar cleaners.stripe_onboarding_status automatiskt.
// Skickar notifiering till cleaner när status blir "complete".
//
// Konfiguration i Stripe Dashboard:
// https://dashboard.stripe.com/webhooks
// Endpoint: https://urjeijcncsyuletprydy.supabase.co/functions/v1/stripe-connect-webhook
// Events: account.updated, account.application.deauthorized
// Secret: sparas som STRIPE_WEBHOOK_SECRET_CONNECT i Supabase Edge Functions
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { verifyStripeWebhookSignature } from "../_shared/stripe-webhook-verify.ts";
import { sendSms } from "../_shared/notifications.ts";
import { sendEmail, wrap, corsHeaders } from "../_shared/email.ts";
import { generateMagicShortUrl } from "../_shared/send-magic-sms.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET_CONNECT")!;

const sb = createClient(SUPA_URL, SERVICE_KEY);

interface StripeAccountEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string;  // acct_...
      details_submitted?: boolean;
      charges_enabled?: boolean;
      payouts_enabled?: boolean;
      requirements?: {
        currently_due?: string[];
        past_due?: string[];
        disabled_reason?: string | null;
      };
    };
  };
  account?: string;  // Connect account ID
}

// ─────────────────────────────────────────────────────────
// Hanterare för account.updated
// ─────────────────────────────────────────────────────────
async function handleAccountUpdated(event: StripeAccountEvent): Promise<void> {
  const account = event.data.object;
  const accountId = account.id;
  
  // Hitta cleaner med detta stripe_account_id
  const { data: cleaner, error } = await sb
    .from("cleaners")
    .select("id, full_name, email, phone, stripe_onboarding_status, company_id, is_company_owner")
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  
  if (error || !cleaner) {
    console.warn(JSON.stringify({
      level: "warn",
      fn: "stripe-connect-webhook",
      msg: "No cleaner found for stripe_account_id",
      account_id: accountId,
    }));
    return;
  }
  
  // Bestäm ny status
  let newStatus = cleaner.stripe_onboarding_status;
  const isComplete = account.details_submitted && account.charges_enabled && account.payouts_enabled;
  const hasRequirements = (account.requirements?.currently_due?.length ?? 0) > 0 ||
                          (account.requirements?.past_due?.length ?? 0) > 0;
  
  if (isComplete) {
    newStatus = "complete";
  } else if (hasRequirements) {
    newStatus = "requirements_pending";
  } else if (account.requirements?.disabled_reason) {
    newStatus = "disabled";
  } else {
    newStatus = "pending";
  }
  
  // Om ingen förändring — hoppa över
  if (newStatus === cleaner.stripe_onboarding_status) {
    console.log(JSON.stringify({
      fn: "stripe-connect-webhook",
      msg: "No status change",
      cleaner_id: cleaner.id,
      status: newStatus,
    }));
    return;
  }
  
  // Update cleaners
  const { error: updateErr } = await sb
    .from("cleaners")
    .update({
      stripe_onboarding_status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cleaner.id);
  
  if (updateErr) {
    console.error(JSON.stringify({
      level: "error",
      fn: "stripe-connect-webhook",
      msg: "Failed to update cleaner",
      error: updateErr.message,
    }));
    throw updateErr;
  }
  
  console.log(JSON.stringify({
    fn: "stripe-connect-webhook",
    msg: "Cleaner status updated",
    cleaner_id: cleaner.id,
    from_status: cleaner.stripe_onboarding_status,
    to_status: newStatus,
  }));
  
  // Om blev complete → notifiera cleaner + uppdatera company om VD
  if (newStatus === "complete" && cleaner.stripe_onboarding_status !== "complete") {
    // SMS med magic-link till portal
    const portalLink = await generateMagicShortUrl({
      email: cleaner.email,
      redirect_to: "https://spick.se/stadare-dashboard.html",
      scope: "dashboard",
      ttl_hours: 24,
    });
    
    if (cleaner.phone) {
      await sendSms(
        cleaner.phone,
        `Spick: Din Stripe-registrering är klar! ✅ Du kan nu ta bokningar. Logga in: ${portalLink}`
      );
    }
    
    // Email
    if (cleaner.email) {
      await sendEmail(
        cleaner.email,
        "Stripe-registrering klar — du kan nu ta bokningar",
        wrap(`
          <h2>Välkommen till Spick, ${cleaner.full_name}!</h2>
          <p>Din Stripe-registrering är godkänd och klar. Du kan nu ta emot bokningar och få betalt automatiskt.</p>
          <p><a href="${portalLink}" class="btn">Öppna mitt Spick →</a></p>
          <p style="color:#6b7280;font-size:14px;">
            Pengar från dina städningar betalas ut automatiskt 1-2 bankdagar efter genomförd städning.
          </p>
        `)
      );
    }
    
    // Uppdatera company.onboarding_status OCH stripe_account_id om VD blev complete
    // (Bugfix 2026-04-19: säkerhetsnät om onboard_cleaner-synken missade.)
    if (cleaner.is_company_owner && cleaner.company_id) {
      await sb
        .from("companies")
        .update({
          stripe_account_id: accountId,                // ← NY: synka till company
          onboarding_status: "pending_team",
          updated_at: new Date().toISOString(),
        })
        .eq("id", cleaner.company_id);
      
      console.log(JSON.stringify({
        fn: "stripe-connect-webhook",
        msg: "Company advanced to pending_team",
        company_id: cleaner.company_id,
      }));
    }
  }
  
  // Om krav saknas → notifiera cleaner att slutföra
  if (newStatus === "requirements_pending" && cleaner.stripe_onboarding_status !== "requirements_pending") {
    // Notifiera att mer info krävs — admin får ping om flera dagar
    if (cleaner.phone) {
      const refreshLink = await generateMagicShortUrl({
        email: cleaner.email,
        redirect_to: "https://spick.se/stadare-dashboard.html?section=stripe",
        scope: "dashboard",
        ttl_hours: 168,
      });
      
      await sendSms(
        cleaner.phone,
        `Spick: Stripe behöver mer information för att godkänna dina utbetalningar. Slutför här: ${refreshLink}`
      );
    }
  }
}

// ─────────────────────────────────────────────────────────
// Hanterare för account.application.deauthorized
// ─────────────────────────────────────────────────────────
async function handleDeauthorized(event: StripeAccountEvent): Promise<void> {
  const accountId = event.account ?? event.data.object.id;

  const { data: cleaner } = await sb
    .from("cleaners")
    .select("id, full_name, email, phone, company_id, is_company_owner")
    .eq("stripe_account_id", accountId)
    .maybeSingle();

  if (!cleaner) return;

  await sb
    .from("cleaners")
    .update({
      stripe_onboarding_status: "deauthorized",
      updated_at: new Date().toISOString(),
    })
    .eq("id", cleaner.id);

  // Om VD deauthade: markera company som suspenderat.
  // (Bugfix 2026-04-19: undvik zombie-state där cleaner är deauth men company OK.)
  if (cleaner.is_company_owner && cleaner.company_id) {
    await sb
      .from("companies")
      .update({
        onboarding_status: "suspended",
        updated_at: new Date().toISOString(),
      })
      .eq("id", cleaner.company_id);

    console.warn(JSON.stringify({
      level: "warn",
      fn: "stripe-connect-webhook/handleDeauthorized",
      msg: "Company suspended due to VD deauth",
      cleaner_id: cleaner.id,
      company_id: cleaner.company_id,
    }));
  }

  console.warn(JSON.stringify({
    level: "warn",
    fn: "stripe-connect-webhook",
    msg: "Cleaner deauthorized Stripe",
    cleaner_id: cleaner.id,
  }));

  // Audit-fix P0-4 (2026-04-26): trigga Discord-alert + använd sendEmail
  // till ADMIN-konstanten (env-config) istället för hardcoded.
  // Email + Discord parallellt = redundans vid kanal-fel.
  try {
    const { sendAdminAlert } = await import("../_shared/alerts.ts");
    await sendAdminAlert({
      severity: "critical",
      title: "Cleaner deauthorized Stripe Connect",
      source: "stripe-connect-webhook",
      cleaner_id: cleaner.id,
      message: `${cleaner.full_name} (${cleaner.email}) har kopplat ur Stripe Connect. Utbetalningar blockerade.`,
      metadata: { cleaner_full_name: cleaner.full_name, cleaner_email: cleaner.email },
    });
  } catch (e) {
    console.error("[stripe-connect-webhook] sendAdminAlert failed:", (e as Error).message);
  }

  // Email-alert (parallellt — best-effort fallback)
  await sendEmail(
    Deno.env.get("ADMIN_EMAIL") || "hello@spick.se",
    "⚠ Cleaner har kopplat ur Stripe Connect",
    wrap(`
      <h2>Cleaner-deauthorization</h2>
      <p><strong>${cleaner.full_name}</strong> (${cleaner.email}) har kopplat ur Stripe Connect.</p>
      <p>Utbetalningar till denna cleaner är nu blockerade. Kontakta dem för att återansluta.</p>
    `)
  );
}

// ─────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  
  // Läs raw body (KRÄVS för HMAC-validering)
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("Stripe-Signature");
  
  // Verifiera signatur
  const verify = await verifyStripeWebhookSignature(
    rawBody,
    signatureHeader,
    WEBHOOK_SECRET
  );
  
  if (!verify.valid) {
    console.warn(JSON.stringify({
      level: "warn",
      fn: "stripe-connect-webhook",
      msg: "Signature verification failed",
      reason: verify.reason,
    }));
    return new Response(JSON.stringify({ error: "invalid_signature", reason: verify.reason }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  
  // Parse event
  let event: StripeAccountEvent;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  
  console.log(JSON.stringify({
    fn: "stripe-connect-webhook",
    msg: "Event received",
    event_id: event.id,
    event_type: event.type,
    account: event.account ?? event.data.object.id,
  }));
  
  // Route till hanterare
  try {
    switch (event.type) {
      case "account.updated":
        await handleAccountUpdated(event);
        break;
      
      case "account.application.deauthorized":
        await handleDeauthorized(event);
        break;
      
      default:
        console.log(JSON.stringify({
          fn: "stripe-connect-webhook",
          msg: "Event type ignored",
          event_type: event.type,
        }));
    }
    
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(JSON.stringify({
      level: "error",
      fn: "stripe-connect-webhook",
      msg: "Handler failed",
      event_id: event.id,
      error: (e as Error).message,
    }));
    
    // Returnera 500 så Stripe retryar
    return new Response(JSON.stringify({ error: "handler_failed" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
