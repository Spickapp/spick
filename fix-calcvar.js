const fs = require("fs");
const fp = "C:\\Users\\farha\\spick\\boka.html";
let c = fs.readFileSync(fp, "utf8");

// Replace the broken line that uses undefined _hasFP and _svcs
const oldLine = "if (_hasFP && _svcs.length > 1) h += Math.max(1, Math.ceil(sqm / 40 * 2) / 2); // L\u00e4gg till f\u00f6nsterputstid";
const newLine = "var _svcs = state.services || [state.service];\n    var _hasFP = _svcs.indexOf('F\u00f6nsterputs') > -1;\n    if (_hasFP && _svcs.length > 1) h += Math.max(1, Math.ceil(sqm / 40 * 2) / 2); // L\u00e4gg till f\u00f6nsterputstid";

if (c.includes(oldLine)) {
  c = c.replace(oldLine, newLine);
  fs.writeFileSync(fp, c, "utf8");
  console.log("SUCCESS - _svcs and _hasFP defined");
} else {
  console.log("FAIL - pattern not found");
}
