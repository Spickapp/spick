const fs = require("fs");
const path = require("path");
const dir = "C:\\Users\\farha\\spick";

// Find all HTML files
const files = fs.readdirSync(dir).filter(f => f.endsWith(".html"));
let totalChanges = 0;

files.forEach(f => {
  const fp = path.join(dir, f);
  let c = fs.readFileSync(fp, "utf8");
  const before = c.length;
  
  // Remove script tags referencing these files
  c = c.replace(/<script[^>]*src=["'][^"']*analytics\.js["'][^>]*><\/script>\s*/gi, "");
  c = c.replace(/<script[^>]*src=["'][^"']*pwa\.js["'][^>]*><\/script>\s*/gi, "");
  c = c.replace(/<script[^>]*src=["'][^"']*sw\.js["'][^>]*><\/script>\s*/gi, "");
  
  // Also remove inline service worker registration if any
  c = c.replace(/navigator\.serviceWorker\.register\(['"]\/sw\.js['"]\)[^;]*;?\s*/g, "");
  
  if (c.length !== before) {
    fs.writeFileSync(fp, c, "utf8");
    totalChanges++;
    console.log("CLEANED: " + f);
  }
});

// Confirm the git deletions by removing the files permanently
["analytics.js", "pwa.js", "sw.js"].forEach(f => {
  const fp = path.join(dir, f);
  try {
    fs.accessSync(fp);
    console.log(f + " still exists on disk (git restore may have brought it back)");
  } catch (e) {
    console.log(f + " already deleted from disk");
  }
});

console.log("\nTotal files cleaned: " + totalChanges);
console.log("DONE - now git add + commit");
