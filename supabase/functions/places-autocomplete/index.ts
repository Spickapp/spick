// supabase/functions/places-autocomplete/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "https://spick.se",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { query, country = "se" } = await req.json();

    if (!query || query.length < 3) {
      return new Response(
        JSON.stringify({ predictions: [] }),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Nominatim autocomplete — respekterar User-Agent-krav
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query + ", Sweden");
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", country);
    url.searchParams.set("addressdetails", "1");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Spick/1.0 hello@spick.se" },
    });

    if (!res.ok) throw new Error(`Nominatim ${res.status}`);

    const data = await res.json();

    // Mappa om till det format boka.html förväntar sig: { predictions: [{description}] }
    const predictions = data.map((item: Record<string, string>) => ({
      description: item.display_name,
      place_id:    item.place_id,
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
