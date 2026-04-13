import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

serve(async (req) => {
  const url = new URL(req.url);
  const file = url.searchParams.get("file");

  if (!file || !file.match(/^(SF|KV)-\d{4}-\d{4,5}\.(html|pdf)$/)) {
    return new Response("Invalid file", { status: 400 });
  }

  const bucket = file.startsWith("KV-") ? "receipts" : "invoices";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data, error } = await supabase.storage
    .from(bucket)
    .download(file);

  if (error || !data) {
    return new Response("Not found", { status: 404 });
  }

  const bytes = new Uint8Array(await data.arrayBuffer());

  return new Response(bytes, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
