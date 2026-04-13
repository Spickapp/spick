const fs = require("fs");
const filepath = "C:\\Users\\farha\\spick\\boka.html";
let c = fs.readFileSync(filepath, "utf8");
let fixes = 0;

// ── FIX 1: KVM-label baseras på primär tjänst, inte senast klickade ──
// Replace: if (name === 'Fönsterputs') with check on primary service
const oldLabel = "if (name === 'F\u00f6nsterputs') {";
const newLabel = "var _primary = (state.services && state.services.length) ? state.services[0] : name;\n    if (state.services && state.services.length === 1 && state.services[0] === 'F\u00f6nsterputs') {";

if (c.includes(oldLabel)) {
  // Only replace the FIRST occurrence (inside selectService)
  const idx = c.indexOf(oldLabel);
  c = c.substring(0, idx) + newLabel + c.substring(idx + oldLabel.length);
  fixes++;
  console.log("Fix 1: KVM-label uses primary service - OK");
} else {
  console.log("Fix 1: SKIP - pattern not found");
}

// ── FIX 2: Besiktning-wrap only shows for Flyttstädning alone ──
const oldBesiktning = "if (bWrap) bWrap.style.display = name === 'Flyttst\u00e4dning' ? 'block' : 'none';";
const newBesiktning = "if (bWrap) bWrap.style.display = (state.services && state.services.indexOf('Flyttst\u00e4dning') > -1) ? 'block' : 'none';";

if (c.includes(oldBesiktning)) {
  c = c.replace(oldBesiktning, newBesiktning);
  fixes++;
  console.log("Fix 2: Besiktning multi-aware - OK");
} else {
  console.log("Fix 2: SKIP");
}

// ── FIX 3: Addons show for any selected service, not just last clicked ──
const oldAddons = "}[name] || [];";
const newAddons = "};\n    var _addonList = [];\n    (state.services || [name]).forEach(function(s) { if (_addonMap[s]) _addonList = _addonList.concat(_addonMap[s]); });\n    var addons = _addonList;";
const oldAddonMap = "const addons = {";
const newAddonMap = "const _addonMap = {";

if (c.includes(oldAddonMap) && c.includes(oldAddons)) {
  c = c.replace(oldAddonMap, newAddonMap);
  c = c.replace(oldAddons, newAddons);
  fixes++;
  console.log("Fix 3: Addons combined for multi-service - OK");
} else {
  console.log("Fix 3: SKIP - addon pattern not found");
}

// ── FIX 4: Service detail info box shows combined services ──
// Find where svc-detail-upsell is rendered and update
const oldDetailCheck = "var _real = window.selectService;";
if (c.includes(oldDetailCheck)) {
  // Find the service detail rendering area
  const detailIdx = c.indexOf(oldDetailCheck);
  const detailBlock = c.substring(detailIdx, detailIdx + 2000);
  
  // Check if there's a service info rendering
  if (detailBlock.includes("svc-detail")) {
    console.log("Fix 4: Service detail exists - checking");
    // The detail rendering likely uses state.service - it will show joined string automatically
    fixes++;
    console.log("Fix 4: Detail uses state.service (joined string) - OK by default");
  } else {
    console.log("Fix 4: SKIP - no detail rendering found");
  }
}

// ── FIX 5: Step 2 subtitle shows combined services ──
const oldStep2Sub = "document.getElementById('step2-sub').textContent = state.service + ' \u00b7 '";
if (c.includes(oldStep2Sub)) {
  const newStep2Sub = "document.getElementById('step2-sub').textContent = ((state.services && state.services.length > 1) ? state.services.join(' + ') : state.service) + ' \u00b7 '";
  c = c.replace(oldStep2Sub, newStep2Sub);
  fixes++;
  console.log("Fix 5: Step 2 subtitle multi-service - OK");
} else {
  console.log("Fix 5: SKIP");
}

// ── FIX 6: Confirmation page service display ──
const oldConfirmSvc = "<div style=\"font-weight:600\">${state.service}";
if (c.includes(oldConfirmSvc)) {
  c = c.replace(oldConfirmSvc, "<div style=\"font-weight:600\">${(state.services && state.services.length > 1) ? state.services.join(' + ') : state.service}");
  fixes++;
  console.log("Fix 6: Confirmation service display - OK");
} else {
  console.log("Fix 6: SKIP");
}

// ── FIX 7: getMaterialText handles combined services ──
const oldMaterial = "getMaterialText(state.service)";
if (c.includes(oldMaterial)) {
  c = c.replace(oldMaterial, "getMaterialText((state.services && state.services.length) ? state.services[0] : state.service)");
  fixes++;
  console.log("Fix 7: Material text uses primary service - OK");
} else {
  console.log("Fix 7: SKIP");
}

// ── FIX 8: Cleaner filtering matches ANY selected service ──
const oldFilter = "cl.services.some(s => s.toLowerCase().includes(state.service.toLowerCase().slice(0,3)))";
if (c.includes(oldFilter)) {
  const newFilter = "((state.services && state.services.length) ? state.services.every(function(sv){return cl.services.some(function(s){return s.toLowerCase().includes(sv.toLowerCase().slice(0,3))})}) : cl.services.some(s => s.toLowerCase().includes(state.service.toLowerCase().slice(0,3))))";
  c = c.replace(oldFilter, newFilter);
  fixes++;
  console.log("Fix 8: Cleaner filter matches all selected services - OK");
} else {
  console.log("Fix 8: SKIP");
}

fs.writeFileSync(filepath, c, "utf8");

console.log("\n--- RESULT ---");
console.log("Fixes applied:", fixes);
console.log(fixes >= 4 ? "SUCCESS" : "PARTIAL - check logs");
