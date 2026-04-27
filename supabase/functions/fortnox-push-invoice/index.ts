/**
 * fortnox-push-invoice — pusha en booking som faktura till cleaners Fortnox
 *
 * INPUT (POST):
 *   { booking_id: "uuid" }
 *
 * FLÖDE:
 * 1. Hämta booking + verify cleaner äger
 * 2. Hämta Fortnox-credentials för cleaner
 * 3. Refresh token om expired
 * 4. Skapa kund i Fortnox om saknas (per email)
 * 5. POST faktura till Fortnox /3/invoices
 * 6. Markera booking.fortnox_pushed_at + uppdatera last_invoice_pushed_at
 *
 * AUTH: cleaner-JWT eller service_role (för auto-push från charge-EF)
 *
 * MVP-design (Phase 1):
 * - Manuell trigger från stadare-dashboard ("Push till Fortnox"-knapp)
 * - Phase 2: auto-push från stripe-webhook vid paid bookings
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FORTNOX_CLIENT_ID = Deno.env.get("FORTNOX_CLIENT_ID") || "";
const FORTNOX_CLIENT_SECRET = Deno.env.get("FORTNOX_CLIENT_SECRET") || "";

const sb = createClient(SUPA_URL, SERVICE_KEY);

// Refresha access_token om <5 min kvar
async function ensureValidToken(creds: { cleaner_id: string; access_token: string; refresh_token: string; expires_at: string }): Promise<string> {
  const expiresMs = new Date(creds.expires_at).getTime() - Date.now();
  if (expiresMs > 5 * 60 * 1000) {
    return creds.access_token;
  }
  // Refresh
  const basicAuth = btoa(`${FORTNOX_CLIENT_ID}:${FORTNOX_CLIENT_SECRET}`);
  const refreshRes = await fetch("https://apps.fortnox.se/oauth-v1/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refresh_token,
    }).toString(),
  });
  if (!refreshRes.ok) {
    throw new Error(`refresh_failed_${refreshRes.status}`);
  }
  const tokens = await refreshRes.json() as { access_token: string; refresh_token: string; expires_in: number };
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await sb.from("cleaner_fortnox_credentials").update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: newExpiresAt,
    last_refreshed_at: new Date().toISOString(),
  }).eq("cleaner_id", creds.cleaner_id);
  return tokens.access_token;
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const { booking_id } = body as { booking_id?: string };
    if (!booking_id) return new Response(JSON.stringify({ error: "booking_id_required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

    // Auth: antingen cleaner-JWT eller service_role-key
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const isServiceRole = token === SERVICE_KEY;
    let cleanerId: string | null = null;

    if (!isServiceRole) {
      const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY } });
      if (!authRes.ok) return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
      const authUser = await authRes.json() as { email?: string };
      const { data: cleaner } = await sb.from("cleaners").select("id").eq("email", authUser.email).maybeSingle();
      if (!cleaner) return new Response(JSON.stringify({ error: "cleaner_not_found" }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
      cleanerId = cleaner.id;
    }

    // Hämta booking
    const { data: booking, error: bErr } = await sb.from("bookings").select("id, cleaner_id, customer_name, customer_email, customer_phone, customer_address, service_type, booking_date, booking_time, hours, total_price, hourly_rate, payment_status, status").eq("id", booking_id).maybeSingle();
    if (bErr || !booking) return new Response(JSON.stringify({ error: "booking_not_found" }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });

    // Verifiera cleaner-ownership om inte service-role
    if (!isServiceRole && booking.cleaner_id !== cleanerId) {
      return new Response(JSON.stringify({ error: "not_owned_by_cleaner" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (booking.payment_status !== "paid") {
      return new Response(JSON.stringify({ error: "booking_not_paid", current: booking.payment_status }), { status: 422, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Hämta cleaners Fortnox-credentials
    const { data: creds } = await sb.from("cleaner_fortnox_credentials").select("*").eq("cleaner_id", booking.cleaner_id).maybeSingle();
    if (!creds) {
      return new Response(JSON.stringify({ error: "fortnox_not_connected", detail: "Cleaner har inte kopplat Fortnox ännu" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const accessToken = await ensureValidToken(creds);

    // Skapa/upsert kund i Fortnox (vi använder email som natural key)
    // Fortnox API: GET /3/customers?filter=email-eq:foo@bar.com
    let customerNumber: string | null = null;
    const lookupRes = await fetch(`https://api.fortnox.se/3/customers/?filter=active&email=${encodeURIComponent(booking.customer_email)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    if (lookupRes.ok) {
      const lookupData = await lookupRes.json() as { Customers?: Array<{ CustomerNumber: string; Email: string }> };
      const match = lookupData.Customers?.find((c) => c.Email === booking.customer_email);
      if (match) customerNumber = match.CustomerNumber;
    }

    if (!customerNumber) {
      // Skapa ny kund
      const createRes = await fetch("https://api.fortnox.se/3/customers", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          Customer: {
            Name: booking.customer_name || booking.customer_email,
            Email: booking.customer_email,
            Phone1: booking.customer_phone || "",
            Address1: booking.customer_address || "",
            CountryCode: "SE",
            CustomerType: "PRIVATE",
          },
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.text();
        return new Response(JSON.stringify({ error: "fortnox_customer_create_failed", detail: err.slice(0, 300) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
      }
      const newCustomer = await createRes.json() as { Customer?: { CustomerNumber: string } };
      customerNumber = newCustomer.Customer?.CustomerNumber || null;
    }

    if (!customerNumber) {
      return new Response(JSON.stringify({ error: "fortnox_customer_id_missing" }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Skapa faktura i Fortnox
    const invoiceRes = await fetch("https://api.fortnox.se/3/invoices", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        Invoice: {
          CustomerNumber: customerNumber,
          InvoiceDate: booking.booking_date,
          DueDate: new Date(new Date(booking.booking_date).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          Currency: "SEK",
          Comments: `Spick bokning ${booking_id}`,
          OurReference: "Spick",
          YourReference: booking.customer_name || "",
          InvoiceRows: [
            {
              ArticleNumber: booking.service_type?.replace(/\s+/g, "-").toLowerCase() || "stadning",
              Description: `${booking.service_type || "Städning"} ${booking.booking_date} ${booking.booking_time || ""} (${booking.hours}h)`,
              DeliveredQuantity: booking.hours,
              Price: booking.hourly_rate || (booking.total_price / booking.hours),
              Unit: "h",
              VAT: 25,
            },
          ],
        },
      }),
    });

    if (!invoiceRes.ok) {
      const err = await invoiceRes.text();
      return new Response(JSON.stringify({ error: "fortnox_invoice_create_failed", detail: err.slice(0, 500) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const invoiceData = await invoiceRes.json() as { Invoice?: { DocumentNumber: string } };
    const invoiceNumber = invoiceData.Invoice?.DocumentNumber;

    // Markera last_invoice_pushed_at
    await sb.from("cleaner_fortnox_credentials").update({ last_invoice_pushed_at: new Date().toISOString() }).eq("cleaner_id", booking.cleaner_id);

    return new Response(JSON.stringify({ ok: true, fortnox_invoice_number: invoiceNumber, fortnox_customer_number: customerNumber }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[fortnox-push-invoice]", (e as Error).message);
    return new Response(JSON.stringify({ error: "internal_error", detail: (e as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
