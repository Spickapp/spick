const fs = require("fs");
const filepath = "C:\\Users\\farha\\spick\\supabase\\functions\\booking-create\\index.ts";

let c = fs.readFileSync(filepath, "utf8");

// Fix 1: status="aktiv" -> is_active=true
const before = c;
c = c.split('.eq("status", "aktiv")').join('.eq("is_active", true)');

// Fix 2: total_jobs -> completed_jobs  
c = c.split("total_jobs, home_lat").join("completed_jobs, home_lat");

if (c === before) {
  console.log("WARNING: No changes made - pattern not found!");
} else {
  fs.writeFileSync(filepath, c, "utf8");
  const count = (c.match(/is_active/g) || []).length;
  console.log("PATCHED! is_active occurrences:", count);
}
