const fs = require("fs");
const fp = "C:\\Users\\farha\\spick\\boka.html";
let c = fs.readFileSync(fp, "utf8");

const old = "customer_notes: ((state.hasPets";
const nw = "customer_notes: ((state.extraWindows ? 'F\u00f6nsterputs: ' + state.extraWindows + ' f\u00f6nster. ' : '') + (state.services && state.services.length > 1 ? 'Kombinerad: ' + state.services.join(' + ') + '. ' : '') + (state.hasPets";

if (c.includes(old)) {
  c = c.replace(old, nw);
  fs.writeFileSync(fp, c, "utf8");
  console.log("OK:", c.includes("extraWindows"));
} else {
  console.log("SKIP - pattern not found");
}
