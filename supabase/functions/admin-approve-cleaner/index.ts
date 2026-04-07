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

    const firstName = app.first_name || "";
    const lastName = app.last_name || "";
    const name = app.full_name || app.name || [firstName, lastName].filter(Boolean).join(" ") || "Städare";
    const email = app.email;

    log("info", "admin-approve-cleaner", "Raw application data", {
      id: application_id, action,
      keys: Object.keys(app),
      email: app.email, name, firstName, lastName,
      hourly_rate: app.hourly_rate, services: app.services,
      home_address: app.home_address,
      home_lat: app.home_lat, home_lng: app.home_lng,
      service_radius_km: app.service_radius_km, city: app.city,
      bio: app.bio ? app.bio.substring(0, 80) : null,
      phone: app.phone,
    });

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

      // 3. Create cleaner row — copy ALL fields from application
      // services: keep as-is if already array (jsonb), otherwise split string
      const svcs = Array.isArray(app.services)
        ? app.services
        : (app.services || "Hemstädning").split(",").map((s: string) => s.trim()).filter(Boolean);

      const cleanerData: Record<string, unknown> = {
        // Identity
        full_name: name,
        first_name: firstName || name.split(" ")[0] || "Städare",
        last_name: lastName || name.split(" ").slice(1).join(" ") || "",
        email,
        phone: app.phone || null,

        // Location
        city: app.city || "",
        home_address: app.home_address || "",
        home_lat: app.home_lat != null ? parseFloat(String(app.home_lat)) : null,
        home_lng: app.home_lng != null ? parseFloat(String(app.home_lng)) : null,
        service_radius_km: app.service_radius_km ? parseInt(String(app.service_radius_km)) : 30,

        // Work profile
        hourly_rate: parseFloat(String(app.hourly_rate)) || 350,
        services: svcs,
        bio: app.bio || "",

        // Auth & status
        is_approved: true,
        auth_user_id: authUserId,
        tier: "new",
        commission_rate: 0.17,
        status: "onboarding",
        slug,

        // Stats (new cleaner defaults)
        avg_rating: 0,
        review_count: 0,
        completed_jobs: 0,
        verified: false,
        stripe_onboarding_status: "pending",
        has_fskatt: !!app.fskatt_confirmed,
        fskatt_needs_help: !!app.fskatt_needs_help,

        created_at: new Date().toISOString(),
      };

      console.log("Application data:", JSON.stringify(app));
      console.log("Inserting into cleaners:", JSON.stringify(cleanerData));

      // Check if cleaner already exists (by email)
      const { data: existing } = await sb
        .from("cleaners")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      let cleanerId: string;
      if (existing) {
        await sb.from("cleaners").update({
          ...cleanerData,
          slug: undefined, // don't overwrite slug on re-approve
        }).eq("id", existing.id);
        cleanerId = existing.id;
      } else {
        const { data: inserted, error: insertErr } = await sb.from("cleaners").insert(cleanerData).select("id").single();
        if (insertErr || !inserted) {
          log("error", "admin-approve-cleaner", "Insert cleaner failed", { error: insertErr?.message });
          return json({ error: "Kunde inte skapa städarprofil: " + (insertErr?.message || "unknown") }, 500, CORS);
        }
        cleanerId = inserted.id;
      }

      // 3b. If company application, create company and link
      if (app.is_company && app.company_name) {
        try {
          const { data: company, error: compErr } = await sb.from("companies").insert({
            name: app.company_name,
            org_number: app.org_number || null,
            owner_cleaner_id: cleanerId,
            commission_rate: 0.17,
          }).select("id").single();

          if (compErr || !company) {
            log("error", "admin-approve-cleaner", "Company insert failed, rolling back", { error: compErr?.message });
            // Rollback: delete cleaner
            await sb.from("cleaners").delete().eq("id", cleanerId);
            if (authUserId) await sb.auth.admin.deleteUser(authUserId);
            return json({ error: "Kunde inte skapa företag: " + (compErr?.message || "unknown") }, 500, CORS);
          }

          // Link cleaner to company
          await sb.from("cleaners").update({
            company_id: company.id,
            is_company_owner: true,
          }).eq("id", cleanerId);

          log("info", "admin-approve-cleaner", "Company created", {
            companyId: company.id,
            companyName: app.company_name,
            ownerId: cleanerId,
          });
        } catch (e) {
          log("error", "admin-approve-cleaner", "Company creation exception", { error: (e as Error).message });
          // Rollback
          await sb.from("cleaners").delete().eq("id", cleanerId);
          if (authUserId) await sb.auth.admin.deleteUser(authUserId);
          return json({ error: "Företagsskapande misslyckades: " + (e as Error).message }, 500, CORS);
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

      // 6. Send welcome email (trilingual: SV + EN + AR)
      const hr = parseInt(app.hourly_rate) || 350;
      const isCompany = app.is_company && app.company_name;
      const html = wrap(`
        <h2>Välkommen till Spick! 🎉</h2>
        <p>Hej ${esc(name)}!</p>
        <p>Grattis — din ansökan är godkänd! Slutför din profil i dashboarden för att börja ta emot bokningar.</p>
        ${isCompany ? `<p>🏢 <strong>${esc(app.company_name)}</strong> är registrerat. Du kan lägga till teammedlemmar via din dashboard.</p>` : ""}
        ${app.fskatt_needs_help ? `
<div style="background:#EDE9FE;border-radius:12px;padding:16px 20px;margin:16px 0;color:#5B21B6">
  <p style="font-size:15px;font-weight:700;margin:0 0 8px">📋 Du behöver F-skatt — vi gör det enkelt!</p>
  <p style="font-size:14px;margin:0 0 12px">Utan F-skatt kan du inte ta emot bokningar. Men det tar bara 10 minuter och är helt gratis. Så här gör du:</p>
  <ol style="font-size:14px;line-height:1.8;padding-left:20px;margin:0 0 12px">
    <li>Öppna <a href="https://www.verksamt.se/starta/registrera-foretag" style="color:#7C3AED;font-weight:600">verksamt.se</a> och logga in med BankID</li>
    <li>Välj "Enskild näringsverksamhet"</li>
    <li>Under verksamhet, skriv: <strong>Hemstädning och hushållsservice</strong></li>
    <li>SNI-kod: <strong>81210</strong> (väljs automatiskt)</li>
    <li>Kryssa i F-skatt (eller FA-skatt om du har en anställning vid sidan av)</li>
    <li>Skicka in — klart!</li>
  </ol>
  <p style="font-size:13px;margin:0 0 8px">Svar från Skatteverket tar 1–5 arbetsdagar. Du kan slutföra din Spick-profil medan du väntar.</p>
  <p style="font-size:13px;margin:0"><a href="https://spick.se/registrera-firma.html" style="color:#7C3AED;font-weight:600">📖 Vår kompletta steg-för-steg guide →</a> · Behöver du hjälp? Ring 076-050 51 53</p>
</div>` : app.fskatt_confirmed ? `<p style="background:#E1F5EE;border-radius:12px;padding:12px 16px;font-size:14px;color:#166534">✅ F-skatt bekräftad — du är redo att ta emot bokningar!</p>` : ""}
        ${card([
          ["Timpris", `${hr} kr/h`],
          ["Provision", "17% (du behåller 83%)"],
          ["Tjänster", svcs.join(", ")],
        ])}
        <p>Klicka på knappen nedan för att logga in på din dashboard där du kan se och hantera bokningar:</p>
        <p><a href="${esc(magicLinkUrl)}" class="btn">Logga in på din dashboard →</a></p>
        <h3 style="margin-top:28px;font-size:15px">📚 Kom igång — tre steg</h3>
        <ol style="font-size:14px;color:#1C1C1A;line-height:1.8;padding-left:20px">
          <li><a href="https://spick.se/stadare-handbok.html" style="color:#0F6E56;font-weight:600">Läs Städarhandboken</a> — allt du behöver veta</li>
          <li><a href="https://spick.se/stadare-test.html" style="color:#0F6E56;font-weight:600">Gör kompetenstestet</a> — 25 frågor, ta 10 min</li>
          <li><a href="https://spick.se/stadare-checklista.html" style="color:#0F6E56;font-weight:600">Kolla checklistorna</a> — använd vid varje uppdrag</li>
        </ol>
        <p style="font-size:13px;color:#9B9B95;margin-top:20px">Länken är giltig i 24 timmar. Du kan alltid begära en ny inloggningslänk via dashboarden.</p>
        <p style="font-size:13px;color:#9B9B95;margin-top:8px">Har du frågor? Ring oss på 076-050 51 53 eller skriv på WhatsApp.</p>
        <p style="margin-top:4px">Välkommen till Spick!<br>Farhad</p>

        <hr style="border:none;border-top:1px solid #E8E8E4;margin:28px 0">

        <h2>Welcome to Spick! 🎉</h2>
        <p>Hi ${esc(name)}!</p>
        <p>Congratulations — your application has been approved! Complete your profile in the dashboard to start receiving bookings.</p>
        ${app.fskatt_needs_help ? `
<div style="background:#EDE9FE;border-radius:12px;padding:16px 20px;margin:16px 0;color:#5B21B6">
  <p style="font-size:15px;font-weight:700;margin:0 0 8px">📋 You need F-tax — we make it easy!</p>
  <p style="font-size:14px;margin:0 0 12px">Without F-tax you cannot receive bookings. It takes 10 minutes and is free. Here's how:</p>
  <ol style="font-size:14px;line-height:1.8;padding-left:20px;margin:0 0 12px">
    <li>Open <a href="https://www.verksamt.se/starta/registrera-foretag" style="color:#7C3AED;font-weight:600">verksamt.se</a> and log in with BankID</li>
    <li>Choose "Enskild näringsverksamhet" (Sole proprietorship)</li>
    <li>Under business activity, write: <strong>Hemstädning och hushållsservice</strong></li>
    <li>SNI code: <strong>81210</strong> (selected automatically)</li>
    <li>Check F-skatt (or FA-skatt if you have employment on the side)</li>
    <li>Submit — done!</li>
  </ol>
  <p style="font-size:13px;margin:0 0 8px">Response from Skatteverket takes 1–5 business days. You can complete your Spick profile while waiting.</p>
  <p style="font-size:13px;margin:0"><a href="https://spick.se/registrera-firma.html" style="color:#7C3AED;font-weight:600">📖 Our complete step-by-step guide →</a> · Need help? Call 076-050 51 53</p>
</div>` : app.fskatt_confirmed ? `<p style="background:#E1F5EE;border-radius:12px;padding:12px 16px;font-size:14px;color:#166534">✅ F-tax confirmed — you're ready to receive bookings!</p>` : ""}
        ${card([
          ["Hourly rate", `${hr} kr/h`],
          ["Commission", "17% (you keep 83%)"],
          ["Services", svcs.join(", ")],
        ])}
        <p>Click the button below to log in to your dashboard where you can see and manage your bookings:</p>
        <p><a href="${esc(magicLinkUrl)}" class="btn">Log in to your dashboard →</a></p>
        <h3 style="margin-top:28px;font-size:15px">📚 Get started — three steps</h3>
        <ol style="font-size:14px;color:#1C1C1A;line-height:1.8;padding-left:20px">
          <li><a href="https://spick.se/stadare-handbok.html" style="color:#0F6E56;font-weight:600">Read the Cleaner Handbook</a> — everything you need to know</li>
          <li><a href="https://spick.se/stadare-test.html" style="color:#0F6E56;font-weight:600">Take the competency test</a> — 25 questions, takes 10 min</li>
          <li><a href="https://spick.se/stadare-checklista.html" style="color:#0F6E56;font-weight:600">Check the checklists</a> — use on every job</li>
        </ol>
        <p style="font-size:13px;color:#9B9B95;margin-top:20px">The link is valid for 24 hours. You can always request a new login link via the dashboard.</p>
        <p style="font-size:13px;color:#9B9B95;margin-top:8px">Questions? Call us at 076-050 51 53 or message on WhatsApp.</p>
        <p style="margin-top:4px">Welcome to Spick!<br>Farhad</p>

        <hr style="border:none;border-top:1px solid #E8E8E4;margin:28px 0">

        <div dir="rtl" style="text-align:right">
          <h2>مرحباً بك في Spick! 🎉</h2>
          <p>مرحباً ${esc(name)}!</p>
          <p>تهانينا — تمت الموافقة على طلبك. أكمل ملفك الشخصي في لوحة التحكم لبدء استقبال الحجوزات.</p>
          ${app.fskatt_needs_help ? `
<div dir="rtl" style="background:#EDE9FE;border-radius:12px;padding:16px 20px;margin:16px 0;color:#5B21B6;text-align:right">
  <p style="font-size:15px;font-weight:700;margin:0 0 8px">📋 تحتاج ضريبة F — سنجعل الأمر سهلاً!</p>
  <p style="font-size:14px;margin:0 0 12px">بدون ضريبة F لا يمكنك استقبال الحجوزات. يستغرق ١٠ دقائق فقط ومجاني تماماً:</p>
  <ol style="font-size:14px;line-height:1.8;padding-right:20px;margin:0 0 12px">
    <li>افتح <a href="https://www.verksamt.se/starta/registrera-foretag" style="color:#7C3AED;font-weight:600">verksamt.se</a> وسجل الدخول بـ BankID</li>
    <li>اختر "Enskild näringsverksamhet"</li>
    <li>تحت النشاط التجاري، اكتب: <strong>Hemstädning och hushållsservice</strong></li>
    <li>رمز SNI: <strong>81210</strong> (يتم اختياره تلقائياً)</li>
    <li>حدد F-skatt (أو FA-skatt إذا كان لديك وظيفة بجانب ذلك)</li>
    <li>أرسل — انتهى!</li>
  </ol>
  <p style="font-size:13px;margin:0 0 8px">الرد من Skatteverket يستغرق ١-٥ أيام عمل. يمكنك إكمال ملفك في Spick أثناء الانتظار.</p>
  <p style="font-size:13px;margin:0"><a href="https://spick.se/registrera-firma.html" style="color:#7C3AED;font-weight:600">📖 دليلنا الكامل خطوة بخطوة →</a> · تحتاج مساعدة؟ اتصل 076-050 51 53</p>
</div>` : app.fskatt_confirmed ? `<p style="background:#E1F5EE;border-radius:12px;padding:12px 16px;font-size:14px;color:#166534">✅ تم تأكيد ضريبة F — أنت جاهز لاستقبال الحجوزات!</p>` : ""}
          ${card([
            ["سعر الساعة", `${hr} كرونة/ساعة`],
            ["العمولة", "١٧٪ (تحتفظ بـ ٨٣٪)"],
            ["الخدمات", svcs.join(", ")],
          ])}
          <p>اضغط على الزر أدناه لتسجيل الدخول إلى لوحة التحكم:</p>
          <p><a href="${esc(magicLinkUrl)}" class="btn">← تسجيل الدخول إلى لوحة التحكم</a></p>
          <h3 style="margin-top:28px;font-size:15px">📚 ابدأ — ثلاث خطوات</h3>
          <ol style="font-size:14px;color:#1C1C1A;line-height:1.8;padding-right:20px">
            <li><a href="https://spick.se/stadare-handbok.html" style="color:#0F6E56;font-weight:600">اقرأ دليل التنظيف</a> — كل ما تحتاج معرفته</li>
            <li><a href="https://spick.se/stadare-test.html" style="color:#0F6E56;font-weight:600">قم باختبار الكفاءة</a> — ٢٥ سؤال، ١٠ دقائق</li>
            <li><a href="https://spick.se/stadare-checklista.html" style="color:#0F6E56;font-weight:600">تحقق من القوائم</a> — استخدمها في كل مهمة</li>
          </ol>
          <p style="font-size:13px;color:#9B9B95;margin-top:20px">الرابط صالح لمدة ٢٤ ساعة. يمكنك دائماً طلب رابط جديد عبر لوحة التحكم.</p>
          <p style="font-size:13px;color:#9B9B95;margin-top:8px">هل لديك أسئلة؟ اتصل بنا على 053 51 050-076 أو عبر WhatsApp.</p>
          <p style="margin-top:4px">مرحباً بك في Spick!<br>فرهاد</p>
        </div>
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
