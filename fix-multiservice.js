const fs = require("fs");
const filepath = "C:\\Users\\farha\\spick\\boka.html";
let c = fs.readFileSync(filepath, "utf8");

// ── 1. Initialize state.services array after state object ──
const stateAnchor = "window.preCompanyId = p.get('company') || null;";
if (!c.includes(stateAnchor)) {
  console.error("ERROR: Could not find state anchor");
  process.exit(1);
}
c = c.replace(stateAnchor, `window.preCompanyId = p.get('company') || null;
  state.services = [];`);
console.log("1. state.services initialized");

// ── 2. Replace selectService to support toggle/multi-select ──
const oldSelectService = `function selectService(name, icon, desc, time) {
  state.service = name;`;

const newSelectService = `function selectService(name, icon, desc, time) {
  // Multi-service toggle
  if (!state.services) state.services = [];
  var idx = state.services.indexOf(name);
  if (idx > -1) {
    // Deselect
    state.services.splice(idx, 1);
  } else {
    // Select (max 3 tjänster)
    if (state.services.length >= 3) {
      state.services.shift(); // Ta bort äldsta
    }
    state.services.push(name);
  }
  // Backward compat: state.service = joined string or first
  state.service = state.services.join(' + ') || '';`;

c = c.replace(oldSelectService, newSelectService);
console.log("2. selectService toggle logic added");

// ── 3. Fix the .selected toggle to support multi ──
const oldToggle = `document.querySelectorAll('.svc-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.svc === name);
  });`;

const newToggle = `document.querySelectorAll('.svc-btn').forEach(b => {
    b.classList.toggle('selected', state.services.indexOf(b.dataset.svc) > -1);
  });`;

c = c.replace(oldToggle, newToggle);
console.log("3. Multi-select toggle UI fixed");

// ── 4. Update calcHours to handle combined services ──
const oldCalcHoursCheck = "if (state.service === 'Storstädning') h = Math.ceil(h * 1.7 * 2) / 2;";
if (!c.includes(oldCalcHoursCheck)) {
  console.error("ERROR: Could not find calcHours service check");
  process.exit(1);
}

// Find the full block and replace with multi-service aware version
const oldCalcBlock = `if (state.service === 'Storstädning') h = Math.ceil(h * 1.7 * 2) / 2;
    else if (state.service === 'Flyttstädning') h = Math.ceil(h * 2.2 * 2) / 2;`;

const newCalcBlock = `var _svcs = state.services || [state.service];
    var _hasStor = _svcs.indexOf('Storstädning') > -1;
    var _hasF = _svcs.indexOf('Flyttstädning') > -1;
    var _hasFP = _svcs.indexOf('Fönsterputs') > -1;
    var _hasKontor = _svcs.indexOf('Kontorsstädning') > -1;
    // Primär tjänst bestämmer bas-timmar
    if (_hasF) h = Math.ceil(h * 2.2 * 2) / 2;
    else if (_hasStor) h = Math.ceil(h * 1.7 * 2) / 2;`;

c = c.replace(oldCalcBlock, newCalcBlock);
console.log("4. calcHours multi-service aware");

// ── 5. Add extra hours for secondary services (after Fönsterputs check) ──
const fonsterCalc = "else if (state.service === 'Fönsterputs') h = Math.max(1, Math.ceil(sqm / 40 * 2) / 2);";
const newFonsterCalc = `else if (state.services && state.services.length === 1 && state.services[0] === 'Fönsterputs') h = Math.max(1, Math.ceil(sqm / 40 * 2) / 2);
    // Extra tid för kombinerade tjänster
    if (_hasFP && _svcs.length > 1) h += Math.max(1, Math.ceil(sqm / 40 * 2) / 2); // Lägg till fönsterputstid`;

c = c.replace(fonsterCalc, newFonsterCalc);
console.log("5. Fönsterputs combo hours added");

// ── 6. Update sidebar service display ──
const oldSidebarSvc = "document.getElementById('s-svc').textContent     = state.service;";
if (c.includes(oldSidebarSvc)) {
  c = c.replace(oldSidebarSvc,
    "document.getElementById('s-svc').textContent     = (state.services && state.services.length > 1) ? state.services.join(' + ') : state.service;"
  );
  console.log("6. Sidebar multi-service display");
} else {
  console.log("6. SKIP - sidebar svc display not found (may be different format)");
}

// ── 7. Add visual hint that multi-select is possible ──
const svcGridEnd = '<button class="svc-btn" onclick="selectService(\'Kontorsstädning\'';
if (c.includes(svcGridEnd)) {
  // Find the closing of the service grid and add hint after
  const svcSectionEnd = c.indexOf('</div>', c.indexOf(svcGridEnd) + 100);
  if (svcSectionEnd > -1) {
    // Find the next </div> which closes the grid
    const afterGrid = c.indexOf('</div>', svcSectionEnd + 6);
    if (afterGrid > -1) {
      const hint = '\n          <div id="multi-svc-hint" style="font-size:.72rem;color:var(--m);text-align:center;margin-top:8px;display:none">Flera tjänster valda — timpris baseras på huvudtjänsten</div>';
      c = c.substring(0, afterGrid + 6) + hint + c.substring(afterGrid + 6);
      console.log("7. Multi-select hint added");
    }
  }
}

// ── 8. Show/hide multi-hint in selectService ──
const scrollIntoView = "setTimeout(function() {\n    var sqm = document.getElementById('sqm');";
if (c.includes(scrollIntoView)) {
  c = c.replace(scrollIntoView,
    `var multiHint = document.getElementById('multi-svc-hint');
  if (multiHint) multiHint.style.display = state.services && state.services.length > 1 ? 'block' : 'none';
  setTimeout(function() {
    var sqm = document.getElementById('sqm');`
  );
  console.log("8. Multi-hint toggle added");
}

// ── 9. Fix step 3 summary display ──
const oldS3Svc = "document.getElementById('s3-svc').textContent = state.service || '–';";
if (c.includes(oldS3Svc)) {
  c = c.replace(oldS3Svc,
    "document.getElementById('s3-svc').textContent = (state.services && state.services.length > 1) ? state.services.join(' + ') : (state.service || '–');"
  );
  console.log("9. Step 3 summary multi-service");
} else {
  console.log("9. SKIP - s3-svc not found");
}

// ── 10. Fix validation - at least one service selected ──
const oldValidation = "if (!state.service) {";
if (c.includes(oldValidation)) {
  c = c.replace(oldValidation, "if (!state.service && (!state.services || !state.services.length)) {");
  console.log("10. Validation updated");
} else {
  console.log("10. SKIP - validation pattern not found");
}

fs.writeFileSync(filepath, c, "utf8");

// Verify
const final = fs.readFileSync(filepath, "utf8");
console.log("\n--- VERIFICATION ---");
console.log("state.services init:", final.includes("state.services = []"));
console.log("Multi-toggle:", final.includes("state.services.indexOf(name)"));
console.log("Multi-select UI:", final.includes("state.services.indexOf(b.dataset.svc)"));
console.log("Combined hours:", final.includes("_hasFP && _svcs.length > 1"));
console.log("Sidebar joined:", final.includes("state.services.join(' + ')"));
console.log("Multi-hint:", final.includes("multi-svc-hint"));

const allGood = final.includes("state.services.indexOf(name)") && final.includes("_hasFP");
console.log(allGood ? "\nSUCCESS" : "\nPARTIAL - check logs above");
