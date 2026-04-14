// calendar-google-callback — Google OAuth callback
// Tar emot auth code, utbyter mot tokens, sparar i calendar_connections

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const BASE_URL = Deno.env.get("BASE_URL") || "https://spick.se";

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/calendar-google-callback`;

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Användaren nekade
    if (error) {
      console.log("Google OAuth denied:", error);
      return Response.redirect(`${BASE_URL}/stadare-dashboard.html?cal_error=denied`, 302);
    }

    if (!code || !stateParam) {
      return Response.redirect(`${BASE_URL}/stadare-dashboard.html?cal_error=missing_params`, 302);
    }

    // Dekoda state → cleaner_id
    let cleanerId: string;
    try {
      const state = JSON.parse(atob(stateParam));
      cleanerId = state.cleaner_id;
    } catch {
      return Response.redirect(`${BASE_URL}/stadare-dashboard.html?cal_error=invalid_state`, 302);
    }

    // Utbyt code mot tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Token exchange failed:", err);
      return Response.redirect(`${BASE_URL}/stadare-dashboard.html?cal_error=token_failed`, 302);
    }

    const tokens = await tokenRes.json();
    // tokens: { access_token, refresh_token, expires_in, token_type, scope }

    if (!tokens.access_token) {
      console.error("No access_token in response:", tokens);
      return Response.redirect(`${BASE_URL}/stadare-dashboard.html?cal_error=no_token`, 302);
    }

    // Hämta primary calendar ID
    const calRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const calData = calRes.ok ? await calRes.json() : { id: "primary" };

    // Spara i calendar_connections
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokens.expires_in || 3600));

    const { error: upsertErr } = await supabase
      .from("calendar_connections")
      .upsert({
        cleaner_id: cleanerId,
        provider: "google",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        token_expires_at: expiresAt.toISOString(),
        calendar_id: calData.id || "primary",
        is_active: true,
        sync_direction: "both",
        last_synced_at: null,
      }, {
        onConflict: "cleaner_id,provider",
      });

    if (upsertErr) {
      console.error("Upsert failed:", upsertErr);
      return Response.redirect(`${BASE_URL}/stadare-dashboard.html?cal_error=db_failed`, 302);
    }

    console.log(`Google Calendar connected for cleaner ${cleanerId}`);

    // Trigga initial synk
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/calendar-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
        },
        body: JSON.stringify({ cleaner_id: cleanerId, provider: "google" }),
      });
    } catch (e) {
      console.warn("Initial sync trigger failed (non-critical):", e);
    }

    // Redirect tillbaka till dashboard med success
    return Response.redirect(`${BASE_URL}/stadare-dashboard.html?cal_connected=google`, 302);
  } catch (err) {
    console.error("calendar-google-callback error:", err);
    return Response.redirect(`${BASE_URL}/stadare-dashboard.html?cal_error=unknown`, 302);
  }
});
