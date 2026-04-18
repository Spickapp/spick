import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

  try {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const body = await req.json();

    // ── AUTH: verify admin ──────────────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) {
      return json(401, { error: "Unauthorized — admin-token krävs" });
    }
    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
    });
    if (!authRes.ok) return json(401, { error: "Ogiltig token" });
    const authUser = await authRes.json();
    const { data: adminRow } = await sb
      .from("admin_users")
      .select("id")
      .eq("email", authUser.email)
      .maybeSingle();
    if (!adminRow) return json(403, { error: "Forbidden: inte admin" });

    // ── Validering ──
    if (!body.company_name) return json(400, { error: "Företagsnamn krävs" });
    if (!body.owner_name || !body.owner_email) return json(400, { error: "VD namn och e-post krävs" });
    if (!body.owner_address) return json(400, { error: "VD hemadress krävs" });
    if (body.owner_lat == null || body.owner_lng == null) {
      return json(400, { error: "VD koordinater krävs — välj adress från Google Places-listan" });
    }

    const createdIds: { companyId?: string; ownerCleanerId?: string; ownerAuthId?: string; memberIds: string[]; memberAuthIds: string[] } = {
      memberIds: [], memberAuthIds: []
    };

    // ── 1. Generera företagsslug ──
    const baseSlug = (body.company_name || "foretag")
      .toLowerCase()
      .replace(/[åä]/g, "a").replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const { data: slugExists } = await sb.from("companies").select("id").like("slug", baseSlug + "%");
    const companySlug = slugExists?.length ? baseSlug + "-" + (slugExists.length + 1) : baseSlug;

    // ── 2. Skapa företag ──
    const { data: company, error: compErr } = await sb.from("companies").insert({
      name: body.company_name,
      org_number: body.org_number || null,
      slug: companySlug,
      description: body.bio || null,
      commission_rate: body.commission_rate ?? 12,
      employment_model: body.employment_model || "employed",
    }).select("id").single();

    if (compErr || !company) return json(500, { error: "Kunde inte skapa företag: " + (compErr?.message || "") });
    createdIds.companyId = company.id;

    // ── 3. Skapa VD auth-konto ──
    const { data: ownerAuth, error: authErr } = await sb.auth.admin.createUser({
      email: body.owner_email,
      email_confirm: true,
    });
    if (authErr) {
      // Rollback: ta bort företaget
      await sb.from("companies").delete().eq("id", company.id);
      return json(500, { error: "Kunde inte skapa VD-konto: " + authErr.message });
    }
    createdIds.ownerAuthId = ownerAuth.user.id;

    // ── 4. Generera VD-slug ──
    const ownerBaseSlug = (body.owner_name).toLowerCase()
      .replace(/[åä]/g, "a").replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const { data: ownerSlugExists } = await sb.from("cleaners").select("id").like("slug", ownerBaseSlug + "%");
    const ownerSlug = ownerSlugExists?.length ? ownerBaseSlug + "-" + (ownerSlugExists.length + 1) : ownerBaseSlug;

    // ── 5. Skapa VD cleaner-rad ──
    const nameParts = body.owner_name.trim().split(/\s+/);
    const { data: ownerCleaner, error: ownerErr } = await sb.from("cleaners").insert({
      full_name: body.owner_name,
      first_name: nameParts[0] || "",
      last_name: nameParts.slice(1).join(" ") || "",
      email: body.owner_email,
      phone: body.owner_phone || null,
      slug: ownerSlug,
      city: body.city || "",
      home_address: body.owner_address || "",
      home_lat: body.owner_lat || null,
      home_lng: body.owner_lng || null,
      auth_user_id: ownerAuth.user.id,
      company_id: company.id,
      is_company_owner: true,
      owner_only: body.owner_only ?? true,
      is_approved: true,
      status: "onboarding",
      hourly_rate: body.services?.[0]?.price || 350,
      services: body.services?.map((s: { service_type: string }) => s.service_type) || [],
      commission_rate: body.commission_rate ?? 12,
      tier: "new",
      service_radius_km: 30,
      has_fskatt: true, // Företag har alltid F-skatt
      avg_rating: 0,
      review_count: 0,
      completed_jobs: 0,
    }).select("id").single();

    if (ownerErr || !ownerCleaner) {
      // Rollback
      await sb.auth.admin.deleteUser(ownerAuth.user.id);
      await sb.from("companies").delete().eq("id", company.id);
      return json(500, { error: "Kunde inte skapa VD-profil: " + (ownerErr?.message || "") });
    }
    createdIds.ownerCleanerId = ownerCleaner.id;

    // Länka företag till ägare
    await sb.from("companies").update({ owner_cleaner_id: ownerCleaner.id }).eq("id", company.id);

    // ── 6. Skapa företagspriser ──
    if (body.services?.length) {
      for (const svc of body.services) {
        if (svc.price && svc.price > 0) {
          await sb.from("company_service_prices").upsert({
            company_id: company.id,
            service_type: svc.service_type,
            price: svc.price,
            price_type: svc.price_type || "hourly",
          }, { onConflict: "company_id,service_type" });
        }
      }
    }

    // ── 7. Skapa VD availability (default mån-sön 08-20) ──
    for (let day = 1; day <= 7; day++) {
      await sb.from("cleaner_availability_v2").insert({
        cleaner_id: ownerCleaner.id,
        day_of_week: day,
        start_time: "08:00",
        end_time: "20:00",
        is_active: true,
      });
    }

    // ── 8. Skapa teammedlemmar ──
    for (const member of (body.team_members || [])) {
      try {
        // 8a. Auth-konto (om e-post finns)
        let memberAuthId: string | null = null;
        if (member.email) {
          const { data: mAuth, error: mAuthErr } = await sb.auth.admin.createUser({
            email: member.email,
            email_confirm: true,
          });
          if (mAuthErr) {
            console.warn("Auth for " + member.full_name + " failed:", mAuthErr.message);
            // Fortsätt ändå — e-post kan läggas till senare
          } else {
            memberAuthId = mAuth.user.id;
            createdIds.memberAuthIds.push(memberAuthId);
          }
        }

        // 8b. Generera slug
        const mBaseSlug = (member.full_name || "stadare").toLowerCase()
          .replace(/[åä]/g, "a").replace(/ö/g, "o")
          .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const { data: mSlugExists } = await sb.from("cleaners").select("id").like("slug", mBaseSlug + "%");
        const mSlug = mSlugExists?.length ? mBaseSlug + "-" + (mSlugExists.length + 1) : mBaseSlug;

        // 8c. Namn
        const mParts = (member.full_name || "").trim().split(/\s+/);

        // 8d. Bestäm timpris (override eller företagets standard)
        const defaultRate = body.services?.[0]?.price || 350;

        // 8e. Skapa cleaner-rad
        const { data: mCleaner, error: mErr } = await sb.from("cleaners").insert({
          full_name: member.full_name,
          first_name: mParts[0] || "",
          last_name: mParts.slice(1).join(" ") || "",
          email: member.email || null,
          phone: member.phone || null,
          slug: mSlug,
          city: member.city || body.city || "",
          home_address: member.home_address || "",
          home_lat: member.home_lat || null,
          home_lng: member.home_lng || null,
          service_radius_km: member.service_radius_km || 30,
          auth_user_id: memberAuthId,
          company_id: company.id,
          is_company_owner: false,
          is_approved: true, // Auto-godkänd via wizard
          status: "onboarding",
          hourly_rate: defaultRate,
          services: member.services || [],
          languages: member.languages || [],
          pet_pref: member.pet_pref || "ok",
          commission_rate: body.commission_rate ?? 12,
          tier: "new",
          has_fskatt: (body.employment_model === "employed"), // Anställda = F-skatt via företag
          avg_rating: 0,
          review_count: 0,
          completed_jobs: 0,
        }).select("id").single();

        if (mErr || !mCleaner) {
          console.error("Member create failed:", member.full_name, mErr?.message);
          continue; // Hoppa över denna, fortsätt med nästa
        }
        createdIds.memberIds.push(mCleaner.id);

        // 8f. Per-person prisöverrides
        if (member.price_overrides?.length) {
          for (const po of member.price_overrides) {
            if (po.price && po.price > 0) {
              await sb.from("cleaner_service_prices").upsert({
                cleaner_id: mCleaner.id,
                service_type: po.service_type,
                price: po.price,
                price_type: po.price_type || "hourly",
              }, { onConflict: "cleaner_id,service_type" });
            }
          }
        }

        // 8g. Default availability (mån-sön 08-20)
        for (let day = 1; day <= 7; day++) {
          await sb.from("cleaner_availability_v2").insert({
            cleaner_id: mCleaner.id,
            day_of_week: day,
            start_time: "08:00",
            end_time: "20:00",
            is_active: true,
          });
        }

      } catch (memberError) {
        console.error("Member creation error:", member.full_name, (memberError as Error).message);
        // Fortsätt med nästa — ej kritiskt
      }
    }

    // ── 9. Skicka välkomstmejl till VD ──
    if (RESEND_KEY) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Spick <hello@spick.se>",
            to: body.owner_email,
            subject: "Välkommen till Spick – " + body.company_name,
            html: "<h2>Välkommen till Spick!</h2><p>Ditt företag <strong>" + body.company_name + "</strong> är nu registrerat.</p><p>Logga in på din dashboard: <a href='https://spick.se/stadare-dashboard.html'>spick.se/stadare-dashboard.html</a></p><p>Använd din e-post " + body.owner_email + " för att logga in med engångskod.</p><p>Hälsningar,<br>Spick-teamet</p>",
          }),
        });
      } catch (_) { /* Ej kritiskt */ }
    }

    // ── 10. Returnera allt ──
    return json(200, {
      success: true,
      company_id: company.id,
      company_slug: companySlug,
      owner_cleaner_id: ownerCleaner.id,
      team_member_ids: createdIds.memberIds,
      public_url: "https://spick.se/f/" + companySlug,
      message: "Företag skapat med " + createdIds.memberIds.length + " teammedlemmar",
    });

  } catch (e) {
    console.error("admin-create-company error:", e);
    return json(500, { error: (e as Error).message });
  }
});
