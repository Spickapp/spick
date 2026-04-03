import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/email.ts";

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY")!;

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { query, country = "se" } = await req.json();

    if (!query || query.length < 3) {
      return new Response(
        JSON.stringify({ predictions: [] }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", query);
    url.searchParams.set("components", "country:" + country);
    url.searchParams.set("types", "address");
    url.searchParams.set("language", "sv");
    url.searchParams.set("key", GOOGLE_API_KEY);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("Google Places " + res.status);

    const data = await res.json();

    // Google returnerar 200 även vid fel — kolla status-fältet
    if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Google Places error:", data.status, data.error_message);
      return new Response(
        JSON.stringify({ predictions: [], error: data.status + ": " + (data.error_message || "Unknown error") }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const predictions = (data.predictions || []).map((p: any) => ({
      description: p.description,
      place_id: p.place_id,
    }));

    return new Response(
      JSON.stringify({ predictions }),
      { headers: { "Content-Type": "application/json", ...CORS } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message, predictions: [] }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});
