/**
 * stripe-connect – Stripe Connect onboarding för städare
 *
 * Actions:
 * - onboard_cleaner: Skapar Stripe Express-konto + account_link
 * - check_status: Kollar onboarding-status (details_submitted + charges_enabled)
 * - refresh_account_link: Ny account_link för existerande konto (om onboarding avbrutits)
 *
 * Transfer-logik (utbetalning till städare efter bokning) ligger i
 * _shared/money.ts::triggerStripeTransfer (§1.1-infrastruktur, aktiverad
 * via §1.4 admin-mark-payouts-paid EF). Tidigare payout_cleaner-action
 * här var död kod (0 callers, bruten mot DB-schema) och raderades i §1.3.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const STRIPE_SECRET_KEY    = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL         = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY")!;
const BASE_URL             = "https://spick.se";
const FROM                 = "Spick <hello@spick.se>";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Stripe API helper ─────────────────────────────────────────────────────
async function stripe(path: string, method = "GET", body?: Record<string, unknown>) {
  const opts: RequestInit = {
    method,
    headers: {
      "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2023-10-16",
    },
  };
  if (body) {
    opts.body = new URLSearchParams(
      Object.entries(body).flatMap(([k, v]) =>
        Array.isArray(v) ? v.map(i => [k, String(i)]) : [[k, String(v)]]
      )
    ).toString();
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, opts);
  return res.json();
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const { action, ...params } = await req.json();

  try {
    // ── 1. Skapa Stripe Connect-konto för ny städare ──────────
    if (action === "onboard_cleaner") {
      const { cleaner_id, email, name } = params;

      // Audit 2026-04-26 (Farhad-rapport): tidigare skapade EF nytt
      // Stripe-konto VID VARJE anrop. Resultat: 11 anslutna konton i
      // Stripe Dashboard varav många dupes (Solid Service ×3, Farhad ×3,
      // Rafa ×2). Defensiv check: om cleaner redan har stripe_account_id
      // → branch till refresh_account_link-logik istf skapa nytt.
      const { data: existing } = await sb.from("cleaners")
        .select("stripe_account_id, is_company_owner, company_id")
        .eq("id", cleaner_id)
        .maybeSingle();

      if (existing?.stripe_account_id) {
        console.log("[SPICK] Cleaner har redan Stripe-konto, återanvänder:", existing.stripe_account_id);
        const refreshLink = await stripe("/account_links", "POST", {
          account: existing.stripe_account_id,
          refresh_url: `${BASE_URL}/stadare-dashboard.html?stripe=refresh`,
          return_url:  `${BASE_URL}/stadare-dashboard.html?stripe=success`,
          type: "account_onboarding",
        });
        if (refreshLink.error) throw new Error(refreshLink.error.message);
        return new Response(JSON.stringify({
          ok: true,
          url: refreshLink.url,
          account_id: existing.stripe_account_id,
          reused: true,
        }), {
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }

      // Kolla om städaren är VD med företag (för nytt konto-skapande)
      const cleanerRow = existing;

      let companyData: { name?: string; org_number?: string } | null = null;
      if (cleanerRow?.is_company_owner && cleanerRow?.company_id) {
        const { data: comp } = await sb.from("companies")
          .select("name, org_number")
          .eq("id", cleanerRow.company_id)
          .maybeSingle();
        if (comp?.org_number) companyData = comp;
      }

      // Bygg Stripe-parametrar baserat på om det är företag eller individ
      const isCompanyAccount = !!companyData;

      const accountParams: Record<string, string> = {
        type: "express",
        country: "SE",
        email,
        "capabilities[transfers][requested]": "true",
        "settings[payouts][schedule][interval]": "daily",
        "metadata[cleaner_id]": cleaner_id,
      };

      if (isCompanyAccount) {
        accountParams.business_type = "company";
        accountParams["company[name]"] = companyData!.name!;
        const taxId = (companyData!.org_number || "").replace(/[^0-9]/g, "");
        if (taxId.length >= 10) {
          accountParams["company[tax_id]"] = taxId;
        }
        console.log("[SPICK] Creating COMPANY Stripe account:", companyData!.name, taxId);
      } else {
        // Solo-städare → business_type: individual (som förut)
        accountParams.business_type = "individual";
        accountParams["individual[email]"] = email;
        accountParams["individual[first_name]"] = name?.split(" ")[0] || "";
        accountParams["individual[last_name]"] = name?.split(" ").slice(1).join(" ") || "";
      }

      // Skapa Express-konto i Stripe
      const account = await stripe("/accounts", "POST", accountParams);

      if (account.error) throw new Error(account.error.message);

      // Spara stripe_account_id på städaren
      await sb.from("cleaners").update({
        stripe_account_id: account.id,
        stripe_onboarding_status: "pending",
      }).eq("id", cleaner_id);

      // Om VD av företag: synka stripe_account_id till companies-raden också.
      // (Bugfix 2026-04-19: Solid Service saknade företags-Stripe-ID.)
      if (isCompanyAccount && cleanerRow?.company_id) {
        const { error: compErr } = await sb.from("companies").update({
          stripe_account_id: account.id,
          updated_at: new Date().toISOString(),
        }).eq("id", cleanerRow.company_id);

        if (compErr) {
          console.error(JSON.stringify({
            level: "error",
            fn: "stripe-connect/onboard_cleaner",
            msg: "Failed to sync stripe_account_id to companies",
            company_id: cleanerRow.company_id,
            error: compErr.message,
          }));
          // Lös inte throw — cleaner-raden är redan uppdaterad, kritisk fel ej blockerande
        }
      }

      // Skapa onboarding-länk (städaren fyller i sina uppgifter)
      const link = await stripe("/account_links", "POST", {
        account: account.id,
        refresh_url: `${BASE_URL}/stadare-dashboard.html?stripe=refresh`,
        return_url:  `${BASE_URL}/stadare-dashboard.html?stripe=success`,
        type: "account_onboarding",
      });

      return new Response(JSON.stringify({ ok: true, url: link.url, account_id: account.id }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }


    // ── 2. Generera ny account_link för EXISTERANDE Stripe-konto ──
    //        Används när cleaner behöver slutföra eller uppdatera onboarding
    //        UTAN att skapa nytt account.
    if (action === "refresh_account_link") {
      const { cleaner_id } = params;

      if (!cleaner_id) {
        return new Response(
          JSON.stringify({ ok: false, error: "cleaner_id required" }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Hämta befintligt Stripe-konto-ID
      const { data: cleaner } = await sb.from("cleaners")
        .select("stripe_account_id, email, full_name")
        .eq("id", cleaner_id)
        .maybeSingle();

      if (!cleaner) {
        return new Response(
          JSON.stringify({ ok: false, error: "cleaner_not_found" }),
          { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      if (!cleaner.stripe_account_id) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "no_stripe_account",
            hint: "Use action=onboard_cleaner to create Stripe account first"
          }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Generera ny account_link mot EXISTERANDE account
      const link = await stripe("/account_links", "POST", {
        account: cleaner.stripe_account_id,
        refresh_url: `${BASE_URL}/stadare-dashboard.html?stripe=refresh`,
        return_url:  `${BASE_URL}/stadare-dashboard.html?stripe=success`,
        type: "account_onboarding",
      });

      if (!link.url) {
        console.error(JSON.stringify({
          level: "error",
          fn: "stripe-connect/refresh_account_link",
          error: link.error ?? "unknown",
          account_id: cleaner.stripe_account_id,
        }));
        return new Response(
          JSON.stringify({ ok: false, error: "stripe_error", detail: link.error }),
          { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          url: link.url,
          account_id: cleaner.stripe_account_id,
          expires_at: link.expires_at,
        }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Hämta onboarding-status för städare ────────────────
    if (action === "check_status") {
      const { cleaner_id } = params;
      const { data: cleaner } = await sb.from("cleaners").select("stripe_account_id").eq("id", cleaner_id).single();
      if (!cleaner?.stripe_account_id) {
        return new Response(JSON.stringify({ onboarded: false }), { headers: { "Content-Type": "application/json", ...CORS } });
      }
      const account = await stripe(`/accounts/${cleaner.stripe_account_id}`);
      const onboarded = account.details_submitted && account.charges_enabled;
      await sb.from("cleaners").update({ stripe_onboarding_status: onboarded ? "complete" : "pending" }).eq("id", cleaner_id);
      return new Response(JSON.stringify({ onboarded, account_id: cleaner.stripe_account_id }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    return new Response(JSON.stringify({ error: "Okänd action" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
