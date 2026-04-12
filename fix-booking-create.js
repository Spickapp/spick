const fs = require('fs');
const path = 'C:\\\\Users\\\\farha\\\\spick\\\\supabase\\\\functions\\\\booking-create\\\\index.ts';

// Read file - handle Windows path
const filePath = process.argv[2] || path;
let code = fs.readFileSync(filePath, 'utf8');

// Fix 1: Replace the cleaner_id query (status=aktiv -> is_active=true + owner_only check)
const oldQuery1 = `      const { data, error } = await supabase
        .from("cleaners")
        .select("id, full_name, avg_rating, total_jobs, home_lat, home_lng, phone, hourly_rate")
        .eq("id", cleaner_id)
        .eq("is_approved", true)
        .eq("status", "aktiv")
        .single();

      if (error || !data) {
        return json(400, { error: "Städaren finns inte eller är inaktiv" });
      }
      cleaner = data;`;

const newQuery1 = `      const { data, error } = await supabase
        .from("cleaners")
        .select("id, full_name, avg_rating, completed_jobs, home_lat, home_lng, phone, hourly_rate, tier, owner_only")
        .eq("id", cleaner_id)
        .eq("is_approved", true)
        .eq("is_active", true)
        .single();

      if (error || !data) {
        return json(400, { error: "Städaren finns inte eller är inaktiv" });
      }
      if (data.owner_only) {
        return json(400, { error: "Denna profil tar inte emot bokningar direkt. Välj en teammedlem." });
      }
      cleaner = data;`;

// Fix 2: Replace the fallback query
const oldQuery2 = `      const { data } = await supabase
        .from("cleaners")
        .select("id, full_name, avg_rating, total_jobs, home_lat, home_lng, phone, hourly_rate")
        .eq("is_approved", true)
        .eq("status", "aktiv")
        .order("avg_rating", { ascending: false })
        .limit(1);`;

const newQuery2 = `      const { data } = await supabase
        .from("cleaners")
        .select("id, full_name, avg_rating, completed_jobs, home_lat, home_lng, phone, hourly_rate, tier")
        .eq("is_approved", true)
        .eq("is_active", true)
        .eq("owner_only", false)
        .order("avg_rating", { ascending: false })
        .limit(1);`;

if (!code.includes('.eq("status", "aktiv")')) {
  console.error("ERROR: Could not find the old query pattern. File may have already been patched.");
  process.exit(1);
}

code = code.replace(oldQuery1, newQuery1);
code = code.replace(oldQuery2, newQuery2);

fs.writeFileSync(filePath, code, 'utf8');
console.log("OK - booking-create patched successfully!");
console.log("Changes:");
console.log("  1. status=aktiv -> is_active=true (matches v_cleaners_for_booking)");
console.log("  2. Added owner_only guard");
console.log("  3. total_jobs -> completed_jobs (correct column name)");
console.log("  4. Added tier + owner_only to select");
