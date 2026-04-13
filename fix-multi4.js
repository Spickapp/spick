const fs = require("fs");
const filepath = "C:\\Users\\farha\\spick\\boka.html";
let c = fs.readFileSync(filepath, "utf8");
let fixes = 0;

// ── FIX 1: Replace showServiceDetail to handle multi-service ──
const oldShowDetail = `function showServiceDetail(name) {
  var d = document.getElementById('svc-detail');
  if (!d) return;
  var info = serviceDetails[name];
  if (!info) { d.style.display = 'none'; return; }
  var html = '<div class="svc-detail-title">Vad ing\u00e5r i ' + name.toLowerCase() + '?</div>';
  html += '<div class="svc-detail-grid">';
  if (info.also) html += '<div class="svc-detail-also">' + info.also + '</div>';
  for (var i = 0; i < info.items.length; i++) {
    html += '<div class="svc-detail-item">' + info.items[i] + '</div>';
  }
  html += '</div>';
  if (info.upsell) {
    html += '<div class="svc-detail-upsell">' + info.upsell + ' <a onclick="document.querySelector(\'.svc-btn[data-svc=\\x22' + info.upsellLink + '\\x22]\').click()">V\u00e4lj ' + info.upsellLink + ' \\u2192</a></div>';
  }
  if (info.note) html += '<div class="svc-detail-note">' + info.note + '</div>';
  d.innerHTML = html;
  d.style.display = 'block';
}`;

if (!c.includes('function showServiceDetail(name) {')) {
  console.log("Fix 1: SKIP - showServiceDetail not found");
} else {
  // Use indexOf approach since the exact string match may fail due to encoding
  const startIdx = c.indexOf('function showServiceDetail(name) {');
  const endMarker = "d.style.display = 'block';\n}";
  const endIdx = c.indexOf(endMarker, startIdx);
  
  if (startIdx > -1 && endIdx > -1) {
    const oldBlock = c.substring(startIdx, endIdx + endMarker.length);
    
    const newShowDetail = `function showServiceDetail(name) {
  var d = document.getElementById('svc-detail');
  if (!d) return;
  var svcs = (state.services && state.services.length) ? state.services : [name];
  if (!svcs.length) { d.style.display = 'none'; return; }
  
  var html = '';
  if (svcs.length > 1) {
    html += '<div class="svc-detail-title">Vad ing\u00e5r i ' + svcs.join(' + ').toLowerCase() + '?</div>';
    html += '<div class="svc-detail-grid">';
    svcs.forEach(function(svcName) {
      var info = serviceDetails[svcName];
      if (!info) return;
      html += '<div class="svc-detail-also" style="grid-column:1/-1;font-weight:600;margin-top:8px">' + svcName + ':</div>';
      for (var i = 0; i < info.items.length; i++) {
        html += '<div class="svc-detail-item">' + info.items[i] + '</div>';
      }
    });
    html += '</div>';
    html += '<div class="svc-detail-note">Tiden ber\u00e4knas f\u00f6r samtliga valda tj\u00e4nster.</div>';
  } else {
    var info = serviceDetails[svcs[0]];
    if (!info) { d.style.display = 'none'; return; }
    html += '<div class="svc-detail-title">Vad ing\u00e5r i ' + svcs[0].toLowerCase() + '?</div>';
    html += '<div class="svc-detail-grid">';
    if (info.also) html += '<div class="svc-detail-also">' + info.also + '</div>';
    for (var i = 0; i < info.items.length; i++) {
      html += '<div class="svc-detail-item">' + info.items[i] + '</div>';
    }
    html += '</div>';
    if (info.upsell) {
      html += '<div class="svc-detail-upsell">' + info.upsell + ' <a onclick="document.querySelector(\\'.svc-btn[data-svc=\\\\x22' + info.upsellLink + '\\\\x22]\\').click()">V\u00e4lj ' + info.upsellLink + ' \u2192</a></div>';
    }
    if (info.note) html += '<div class="svc-detail-note">' + info.note + '</div>';
  }
  
  // Extra: visa antal-fönster-fält om Fönsterputs är tillägg
  if (svcs.length > 1 && svcs.indexOf('F\u00f6nsterputs') > -1) {
    html += '<div style="margin-top:12px;padding:12px;background:#F0FDF4;border-radius:10px;border:1px solid #BBF7D0">';
    html += '<label style="font-size:.82rem;font-weight:600;color:#065F46;display:block;margin-bottom:6px">Antal f\u00f6nster (f\u00f6r f\u00f6nsterputs)</label>';
    html += '<input type="number" id="extra-windows" min="1" max="50" placeholder="t.ex. 8" value="' + (state.extraWindows || '') + '" oninput="state.extraWindows=+this.value;calcHours()" style="width:100%;padding:10px 12px;border:1.5px solid #BBF7D0;border-radius:8px;font-size:.88rem;font-family:inherit">';
    html += '</div>';
  }
  
  d.innerHTML = html;
  d.style.display = 'block';
}`;

    c = c.substring(0, startIdx) + newShowDetail + c.substring(endIdx + endMarker.length);
    fixes++;
    console.log("Fix 1: showServiceDetail multi-service - OK");
  } else {
    console.log("Fix 1: Could not find end of function");
  }
}

// ── FIX 2: Update wrapper to pass current service context ──
const oldWrapper = "showServiceDetail(name);";
if (c.includes(oldWrapper)) {
  c = c.replace(oldWrapper, "showServiceDetail(name); // triggers multi-aware detail");
  fixes++;
  console.log("Fix 2: Wrapper updated - OK");
}

// ── FIX 3: Initial call should respect state ──  
const oldInit = "showServiceDetail('Hemst\\u00e4dning');";
const oldInit2 = "showServiceDetail('Hemstädning');";
if (c.includes(oldInit2)) {
  c = c.replace(oldInit2, "showServiceDetail((state.services && state.services.length) ? state.services[0] : 'Hemstädning');");
  fixes++;
  console.log("Fix 3: Initial detail call - OK");
} else if (c.includes(oldInit)) {
  c = c.replace(oldInit, "showServiceDetail((state.services && state.services.length) ? state.services[0] : 'Hemstädning');");
  fixes++;
  console.log("Fix 3: Initial detail call (escaped) - OK");
} else {
  console.log("Fix 3: SKIP");
}

fs.writeFileSync(filepath, c, "utf8");

const final = fs.readFileSync(filepath, "utf8");
console.log("\n--- VERIFICATION ---");
console.log("Multi-service detail:", final.includes("svcs.join(' + ').toLowerCase()"));
console.log("Extra windows field:", final.includes("extra-windows"));
console.log("Combined items:", final.includes("grid-column:1/-1"));
console.log("Fixes applied:", fixes);
console.log(fixes >= 1 ? "SUCCESS" : "FAILED");
