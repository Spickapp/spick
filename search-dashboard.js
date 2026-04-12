const fs = require("fs");
const c = fs.readFileSync("C:\\Users\\farha\\spick\\stadare-dashboard.html", "utf8");
const lines = c.split("\n");
console.log("Total lines:", lines.length);
console.log("\n--- NAV / SECTIONS ---");
lines.forEach((l, i) => {
  if (l.includes("nav-item") || l.includes("section id") || l.includes("tab-") || l.includes("team-section") || l.includes("earnings")) {
    console.log((i + 1) + ": " + l.trim().substring(0, 120));
  }
});
