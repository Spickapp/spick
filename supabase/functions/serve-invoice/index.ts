import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(req.url);
  const file = url.searchParams.get("file");

  if (!file || !file.match(/^(SF|KV)-\d{4}-\d{4,5}\.(html|pdf)$/)) {
    return new Response("Invalid file", { status: 400, headers: CORS });
  }

  const bucket = file.startsWith("KV-") ? "receipts" : "invoices";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data, error } = await supabase.storage.from(bucket).download(file);

  if (error || !data) {
    return new Response("Not found", { status: 404, headers: CORS });
  }

  const text = await data.text();

  return new Response(text, {
    headers: {
      ...CORS,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
});
