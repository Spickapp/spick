// calendar-google-auth — Starta Google OAuth-flöde
// URL: /functions/v1/calendar-google-auth?cleaner_id=XXX
// Redirectar till Google consent screen

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/calendar-google-callback`;
const SCOPES = "https://www.googleapis.com/auth/calendar.events";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" },
    });
  }

  const url = new URL(req.url);
  const cleanerId = url.searchParams.get("cleaner_id");

  if (!cleanerId) {
    return new Response("Missing cleaner_id", { status: 400 });
  }

  if (!GOOGLE_CLIENT_ID) {
    return new Response("Google Calendar integration not configured", { status: 503 });
  }

  // State-parameter: skickar cleaner_id genom OAuth-flödet
  const state = btoa(JSON.stringify({ cleaner_id: cleanerId }));

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");     // ger refresh_token
  authUrl.searchParams.set("prompt", "consent");           // tvinga consent = alltid refresh_token
  authUrl.searchParams.set("state", state);

  return Response.redirect(authUrl.toString(), 302);
});
