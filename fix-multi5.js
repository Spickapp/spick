const fs = require("fs");
const filepath = "C:\\Users\\farha\\spick\\boka.html";
let c = fs.readFileSync(filepath, "utf8");

const s = c.indexOf("function showServiceDetail");
const e = c.indexOf("d.style.display = 'block';", s);
const blockEnd = c.indexOf("}", e + 25);

if (s === -1 || e === -1 || blockEnd === -1) {
  console.log("ERROR: Could not find showServiceDetail boundaries");
  console.log("s:", s, "e:", e, "blockEnd:", blockEnd);
  process.exit(1);
}

const newFn = [
  "function showServiceDetail(name) {",
  "  var d = document.getElementById('svc-detail');",
  "  if (!d) return;",
  "  var svcs = (state.services && state.services.length) ? state.services : [name];",
  "  if (!svcs.length) { d.style.display = 'none'; return; }",
  "  var html = '';",
  "  if (svcs.length > 1) {",
  "    html += '<div class=\"svc-detail-title\">Vad ing\\u00e5r i ' + svcs.join(' + ').toLowerCase() + '?</div>';",
  "    html += '<div class=\"svc-detail-grid\">';",
  "    svcs.forEach(function(sn) {",
  "      var info = serviceDetails[sn]; if (!info) return;",
  "      html += '<div class=\"svc-detail-also\" style=\"grid-column:1/-1;font-weight:600;margin-top:8px\">' + sn + ':</div>';",
  "      for (var i=0;i<info.items.length;i++) html += '<div class=\"svc-detail-item\">' + info.items[i] + '</div>';",
  "    });",
  "    html += '</div>';",
  "    if (svcs.indexOf('F\\u00f6nsterputs') > -1) {",
  "      html += '<div style=\"margin-top:12px;padding:12px;background:#F0FDF4;border-radius:10px;border:1px solid #BBF7D0\">';",
  "      html += '<label style=\"font-size:.82rem;font-weight:600;color:#065F46;display:block;margin-bottom:6px\">Antal f\\u00f6nster</label>';",
  "      html += '<input type=\"number\" id=\"extra-windows\" min=\"1\" max=\"50\" placeholder=\"t.ex. 8\" oninput=\"state.extraWindows=+this.value;calcHours()\" style=\"width:100%;padding:10px 12px;border:1.5px solid #BBF7D0;border-radius:8px;font-size:.88rem;font-family:inherit\">';",
  "      html += '</div>';",
  "    }",
  "    html += '<div class=\"svc-detail-note\">Tiden ber\\u00e4knas f\\u00f6r samtliga valda tj\\u00e4nster.</div>';",
  "  } else {",
  "    var info = serviceDetails[svcs[0]];",
  "    if (!info) { d.style.display = 'none'; return; }",
  "    html += '<div class=\"svc-detail-title\">Vad ing\\u00e5r i ' + svcs[0].toLowerCase() + '?</div>';",
  "    html += '<div class=\"svc-detail-grid\">';",
  "    if (info.also) html += '<div class=\"svc-detail-also\">' + info.also + '</div>';",
  "    for (var i=0;i<info.items.length;i++) html += '<div class=\"svc-detail-item\">' + info.items[i] + '</div>';",
  "    html += '</div>';",
  "    if (info.upsell) html += '<div class=\"svc-detail-upsell\">' + info.upsell + '</div>';",
  "    if (info.note) html += '<div class=\"svc-detail-note\">' + info.note + '</div>';",
  "  }",
  "  d.innerHTML = html;",
  "  d.style.display = 'block';",
  "}"
].join("\r\n");

c = c.substring(0, s) + newFn + c.substring(blockEnd + 1);
fs.writeFileSync(filepath, c, "utf8");

const final = fs.readFileSync(filepath, "utf8");
console.log("Multi detail:", final.includes("svcs.join(' + ')"));
console.log("Extra windows:", final.includes("extra-windows"));
console.log("Combined grid:", final.includes("grid-column:1/-1"));
console.log(final.includes("svcs.join") && final.includes("extra-windows") ? "SUCCESS" : "FAILED");
