const fs = require("fs");
let fixes = 0;

// ═══ 1. DASHBOARD — Toggle under Företagspriser ═══
const dashPath = "C:\\Users\\farha\\spick\\stadare-dashboard.html";
let dash = fs.readFileSync(dashPath, "utf8");

// Add toggle before the company prices list
const pricesListAnchor = '<div id="company-prices-list"';
if (dash.includes(pricesListAnchor)) {
  const toggleHTML = `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100);margin-bottom:12px">
        <div>
          <div style="font-weight:600;font-size:.85rem">Prismodell</div>
          <div style="font-size:.72rem;color:var(--m);margin-top:2px" id="pricing-model-desc">St\u00e4dare s\u00e4tter egna priser</div>
        </div>
        <label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer">
          <input type="checkbox" id="toggle-company-pricing" onchange="togglePricingModel(this.checked)" style="opacity:0;width:0;height:0">
          <span style="position:absolute;inset:0;background:#ccc;border-radius:24px;transition:.2s"></span>
          <span style="position:absolute;left:2px;top:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)" id="pricing-model-knob"></span>
        </label>
      </div>
      `;
  dash = dash.replace(pricesListAnchor, toggleHTML + pricesListAnchor);
  fixes++;
  console.log("1a. Pricing model toggle HTML - OK");
}

// Add JS for pricing model toggle
const loadCompanyPricesAnchor = "async function loadCompanyPrices() {";
if (dash.includes(loadCompanyPricesAnchor)) {
  const pricingModelJS = `async function togglePricingModel(useCompany) {
  if (!window._companyId) return;
  var desc = document.getElementById('pricing-model-desc');
  var knob = document.getElementById('pricing-model-knob');
  var track = knob ? knob.previousElementSibling : null;
  
  if (useCompany) {
    if (desc) desc.textContent = 'Alla st\\u00e4dare visar f\\u00f6retagets priser';
    if (knob) knob.style.left = '22px';
    if (track) track.style.background = 'var(--g)';
  } else {
    if (desc) desc.textContent = 'St\\u00e4dare s\\u00e4tter egna priser';
    if (knob) knob.style.left = '2px';
    if (track) track.style.background = '#ccc';
  }
  
  try {
    await fetch(SUPA_URL + '/rest/v1/companies?id=eq.' + window._companyId, {
      method: 'PATCH',
      headers: Object.assign({}, _authHeaders(), { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ use_company_pricing: useCompany })
    });
    showToast(useCompany ? 'Enhetspriser aktiverade' : 'Individuella priser aktiverade');
  } catch(e) { console.warn('Pricing model toggle error:', e); }
}

async function loadPricingModel() {
  if (!window._companyId) return;
  try {
    var res = await fetch(SUPA_URL + '/rest/v1/companies?id=eq.' + window._companyId + '&select=use_company_pricing', { headers: _authHeaders() });
    var rows = await res.json();
    if (rows && rows[0]) {
      var useCompany = rows[0].use_company_pricing === true;
      var el = document.getElementById('toggle-company-pricing');
      if (el) el.checked = useCompany;
      togglePricingModel(useCompany);
    }
  } catch(e) {}
}
setTimeout(function() { if (window._isCompanyOwner) loadPricingModel(); }, 1600);

`;
  dash = dash.replace(loadCompanyPricesAnchor, pricingModelJS + loadCompanyPricesAnchor);
  fixes++;
  console.log("1b. Pricing model JS - OK");
}

// Add CSS for the toggle
const toggleCSS = "input:checked + span{background:var(--g)!important}";
if (dash.includes(toggleCSS) && !dash.includes("pricing-model-knob{left")) {
  dash = dash.replace(toggleCSS, toggleCSS + "\ninput:checked + span + #pricing-model-knob{left:22px!important}");
  fixes++;
  console.log("1c. Pricing model CSS - OK");
}

fs.writeFileSync(dashPath, dash, "utf8");

// ═══ 2. BOKA.HTML — Respect use_company_pricing ═══
const bokaPath = "C:\\Users\\farha\\spick\\boka.html";
let boka = fs.readFileSync(bokaPath, "utf8");

// Add use_company_pricing to company fetch
const companySelect = "select=id,name,display_name,allow_customer_choice,description,show_individual_ratings";
if (boka.includes(companySelect)) {
  boka = boka.replace(companySelect, companySelect + ",use_company_pricing");
  fixes++;
  console.log("2a. Company fetch includes use_company_pricing - OK");
}

// Store the setting
const storeRatings = "window.companyShowIndividualRatings = rows[0].show_individual_ratings !== false;";
if (boka.includes(storeRatings)) {
  boka = boka.replace(storeRatings, storeRatings + "\n          window.companyUseCompanyPricing = rows[0].use_company_pricing === true;");
  fixes++;
  console.log("2b. use_company_pricing stored - OK");
}

// Modify price resolution to force company price when toggle is on
const priceResolution = "var _primarySvc = (state.services && state.services.length) ? state.services[0] : state.service;\n        var sp = cl._servicePrices && cl._servicePrices.find(function(p) { return p.service_type === _primarySvc; });\n        // Lager 2 fallback: company price\n        if (!sp && window.companyPrices && window.companyPrices[_primarySvc]) {\n          sp = window.companyPrices[_primarySvc];\n        }";

const newPriceResolution = "var _primarySvc = (state.services && state.services.length) ? state.services[0] : state.service;\n        var sp = null;\n        // Lager 1: Om use_company_pricing = true, ALLTID företagspris\n        if (window.companyUseCompanyPricing && window.companyPrices && window.companyPrices[_primarySvc]) {\n          sp = window.companyPrices[_primarySvc];\n        } else {\n          // Lager 2: Individpris först, sedan företagspris som fallback\n          sp = cl._servicePrices && cl._servicePrices.find(function(p) { return p.service_type === _primarySvc; });\n          if (!sp && window.companyPrices && window.companyPrices[_primarySvc]) {\n            sp = window.companyPrices[_primarySvc];\n          }\n        }";

if (boka.includes(priceResolution)) {
  boka = boka.split(priceResolution).join(newPriceResolution);
  fixes++;
  console.log("2c. Price resolution respects use_company_pricing - OK");
} else {
  console.log("2c. SKIP - price resolution pattern not found");
}

fs.writeFileSync(bokaPath, boka, "utf8");

// ═══ SUMMARY ═══
console.log("\n--- SUMMARY ---");
const finalDash = fs.readFileSync(dashPath, "utf8");
const finalBoka = fs.readFileSync(bokaPath, "utf8");

console.log("Dashboard toggle:", finalDash.includes("togglePricingModel"));
console.log("Dashboard load:", finalDash.includes("loadPricingModel"));
console.log("Boka fetches setting:", finalBoka.includes("use_company_pricing"));
console.log("Boka stores setting:", finalBoka.includes("companyUseCompanyPricing"));
console.log("Boka price logic:", finalBoka.includes("companyUseCompanyPricing && window.companyPrices"));
console.log("Fixes:", fixes);
console.log(fixes >= 5 ? "SUCCESS" : "PARTIAL");
