import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, sendEmail, wrap, esc, card, log } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const sb = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── AUTH: verify admin ──────────────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) {
      return json({ error: "Unauthorized" }, 401, CORS);
    }

    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
    });
    if (!authRes.ok) return json({ error: "Invalid token" }, 401, CORS);
    const authUser = await authRes.json();

    const { data: adminRow } = await sb
      .from("admin_users")
      .select("id")
      .eq("email", authUser.email)
      .maybeSingle();
    if (!adminRow) return json({ error: "Forbidden: inte admin" }, 403, CORS);

    // ── PARSE BODY ──────────────────────────────────────────
    const { application_id, action } = await req.json();
    if (!application_id || !["approve", "reject"].includes(action)) {
      return json({ error: "application_id + action (approve|reject) krävs" }, 400, CORS);
    }

    // ── FETCH APPLICATION ───────────────────────────────────
    const { data: app, error: appErr } = await sb
      .from("cleaner_applications")
      .select("*")
      .eq("id", application_id)
      .maybeSingle();

    if (appErr || !app) return json({ error: "Ansökan hittades inte" }, 404, CORS);
    if (app.status && app.status !== "pending") {
      return json({ error: `Ansökan redan hanterad (status: ${app.status})` }, 409, CORS);
    }

    const name = app.name || app.full_name || "Städare";
    const email = app.email;

    // ════════════════════════════════════════════════════════
    // APPROVE
    // ════════════════════════════════════════════════════════
    if (action === "approve") {
      // 1. Create Supabase Auth user
      const { data: authData, error: authError } = await sb.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { role: "cleaner", name },
      });

      if (authError) {
        // User might already exist — try to get existing
        if (authError.message?.includes("already been registered")) {
          log("warn", "admin-approve-cleaner", "Auth user already exists", { email });
          const { data: { users } } = await sb.auth.admin.listUsers();
          const existingUser = users?.find((u: any) => u.email === email);
          if (!existingUser) return json({ error: "Auth-konto finns men kunde inte hittas" }, 500, CORS);
          authData!.user = existingUser;
        } else {
          log("error", "admin-approve-cleaner", "createUser failed", { error: authError.message });
          return json({ error: "Kunde inte skapa konto: " + authError.message }, 500, CORS);
        }
      }

      const authUserId = authData?.user?.id;

      // 2. Generate unique slug
      const baseSlug = (name || "stadare")
        .toLowerCase()
        .replace(/[åä]/g, "a")
        .replace(/ö/g, "o")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const { data: slugExisting } = await sb
        .from("cleaners")
        .select("id")
        .like("slug", `${baseSlug}%`);
      const slug = slugExisting && slugExisting.length > 0
        ? `${baseSlug}-${slugExisting.length + 1}`
        : baseSlug;

      // 3. Create cleaner row
      const svcs = Array.isArray(app.services)
        ? app.services
        : (app.services || "Hemstädning").split(",").map((s: string) => s.trim()).filter(Boolean);

      const cleanerData: Record<string, unknown> = {
        full_name: name,
        email,
        phone: app.phone || null,
        home_lat: app.home_lat || null,
        home_lng: app.home_lng || null,
        service_radius_km: app.service_radius_km || 10,
        hourly_rate: parseInt(app.hourly_rate) || 350,
        services: svcs,
        bio: app.bio || null,
        is_approved: true,
        auth_user_id: authUserId,
        tier: "new",
        commission_rate: 0.17,
        status: "aktiv",
        slug,
        avg_rating: null,
        review_count: 0,
        created_at: new Date().toISOString(),
      };

      // Check if cleaner already exists (by email)
      const { data: existing } = await sb
        .from("cleaners")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (existing) {
        await sb.from("cleaners").update({
          ...cleanerData,
          slug: undefined, // don't overwrite slug on re-approve
        }).eq("id", existing.id);
      } else {
        const { error: insertErr } = await sb.from("cleaners").insert(cleanerData);
        if (insertErr) {
          log("error", "admin-approve-cleaner", "Insert cleaner failed", { error: insertErr.message });
          return json({ error: "Kunde inte skapa städarprofil: " + insertErr.message }, 500, CORS);
        }
      }

      // 4. Update application status
      await sb.from("cleaner_applications").update({
        status: "approved",
        approved_at: new Date().toISOString(),
        reviewed_by: authUser.email,
      }).eq("id", application_id);

      // 5. Generate magic link for welcome email
      let magicLinkUrl = "https://spick.se/stadare-dashboard.html";
      try {
        const { data: linkData } = await sb.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: { redirectTo: "https://spick.se/stadare-dashboard.html" },
        });
        if (linkData?.properties?.action_link) {
          magicLinkUrl = linkData.properties.action_link;
        }
      } catch (e) {
        log("warn", "admin-approve-cleaner", "Magic link generation failed", { error: (e as Error).message });
      }

      // 6. Send welcome email
      const html = wrap(`
        <h2>Välkommen till Spick! 🎉</h2>
        <p>Hej ${esc(name)}!</p>
        <p>Grattis — din ansökan är godkänd! Du är nu en del av Spick-teamet.</p>
        ${card([
          ["Timpris", `${parseInt(app.hourly_rate) || 350} kr/h`],
          ["Provision", "17% (du behåller 83%)"],
          ["Tjänster", svcs.join(", ")],
        ])}
        <p>Klicka på knappen nedan för att logga in på din dashboard där du kan se och hantera bokningar:</p>
        <p><a href="${esc(magicLinkUrl)}" class="btn">Logga in på din dashboard →</a></p>
        <p style="font-size:13px;color:#9B9B95;margin-top:20px">Länken är giltig i 24 timmar. Du kan alltid begära en ny inloggningslänk via dashboarden.</p>
      `);

      await sendEmail(email, "Välkommen till Spick! 🎉 Logga in på din dashboard", html);

      log("info", "admin-approve-cleaner", "Cleaner approved", { email, name, authUserId });
      return json({ success: true, message: `${name} godkänd! Välkomstmejl skickat.` }, 200, CORS);
    }

    // ════════════════════════════════════════════════════════
    // REJECT
    // ════════════════════════════════════════════════════════
    if (action === "reject") {
      await sb.from("cleaner_applications").update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        reviewed_by: authUser.email,
      }).eq("id", application_id);

      // Send rejection email
      const html = wrap(`
        <h2>Uppdatering om din ansökan</h2>
        <p>Hej ${esc(name)},</p>
        <p>Tack för ditt intresse att bli städare på Spick. Tyvärr kan vi inte godkänna din ansökan just nu.</p>
        <p>Det kan bero på att vi just nu har tillräckligt med städare i ditt område, eller att din ansökan inte uppfyllde alla krav.</p>
        <p>Du är välkommen att ansöka igen längre fram. Har du frågor? Kontakta oss på <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a>.</p>
        <p>Vänliga hälsningar,<br>Spick-teamet</p>
      `);

      await sendEmail(email, "Uppdatering om din ansökan till Spick", html);

      log("info", "admin-approve-cleaner", "Cleaner rejected", { email, name });
      return json({ success: true, message: `Ansökan avslagen. Mejl skickat till ${email}.` }, 200, CORS);
    }

    return json({ error: "Ogiltig action" }, 400, CORS);
  } catch (err) {
    log("error", "admin-approve-cleaner", "Unhandled error", { error: (err as Error).message });
    return json({ error: (err as Error).message }, 500, CORS);
  }
});

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
