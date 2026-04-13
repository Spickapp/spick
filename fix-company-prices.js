const fs = require("fs");
let fixes = 0;

// ═══ 1. VD DASHBOARD — Företagspriser-sektion ═══
const dashPath = "C:\\Users\\farha\\spick\\stadare-dashboard.html";
let dash = fs.readFileSync(dashPath, "utf8");

// Add "Företagspriser" section after Betygsvisning toggle
const afterRating = "setTimeout(function() { if (window._isCompanyOwner) loadRatingToggle(); }, 1500);";
if (dash.includes(afterRating)) {
  const companyPricesJS = `

// ═══ FÖRETAGSPRISER (LAGER 1) ═══
async function loadCompanyPrices() {
  if (!window._companyId) return;
  try {
    var res = await fetch(SUPA_URL + '/rest/v1/company_service_prices?company_id=eq.' + window._companyId + '&order=service_type', { headers: _authHeaders() });
    var prices = await res.json() || [];
    renderCompanyPrices(prices);
  } catch(e) { console.warn('loadCompanyPrices error:', e); }
}

function renderCompanyPrices(prices) {
  var wrap = document.getElementById('company-prices-list');
  if (!wrap) return;
  
  // Get company services from owner's profile
  var ownerSvcs = cleaner.services || [];
  var allSvcs = ['Hemst\\u00e4dning','Storst\\u00e4dning','Flyttst\\u00e4dning','F\\u00f6nsterputs','Kontorsst\\u00e4dning','Trappst\\u00e4dning','Skolst\\u00e4dning','V\\u00e5rdst\\u00e4dning','Hotell & restaurang'];
  var svcs = ownerSvcs.length ? ownerSvcs : allSvcs;
  
  var priceMap = {};
  prices.forEach(function(p) { priceMap[p.service_type] = p; });
  
  var html = '';
  svcs.forEach(function(svc) {
    var p = priceMap[svc];
    var price = p ? p.price : '';
    var type = p ? p.price_type : 'hourly';
    html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--gray-100)">';
    html += '<span style="flex:1;font-size:.85rem;font-weight:500">' + svc + '</span>';
    html += '<input type="number" data-cp-svc="' + svc + '" min="50" max="2000" step="10" value="' + price + '" placeholder="Ej satt" style="width:80px;padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;font-size:.82rem;text-align:right">';
    html += '<select data-cp-type="' + svc + '" style="padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:.75rem;background:#fff">';
    html += '<option value="hourly"' + (type === 'hourly' ? ' selected' : '') + '>kr/h</option>';
    html += '<option value="per_sqm"' + (type === 'per_sqm' ? ' selected' : '') + '>kr/kvm</option>';
    html += '</select>';
    html += '</div>';
  });
  
  wrap.innerHTML = html;
}

async function saveCompanyPrices() {
  if (!window._companyId) return;
  var btn = document.getElementById('save-company-prices-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sparar...'; }
  
  try {
    var inputs = document.querySelectorAll('[data-cp-svc]');
    for (var i = 0; i < inputs.length; i++) {
      var svc = inputs[i].dataset.cpSvc;
      var price = parseInt(inputs[i].value);
      var typeEl = document.querySelector('[data-cp-type="' + svc + '"]');
      var priceType = typeEl ? typeEl.value : 'hourly';
      
      if (!price || price <= 0) {
        // Delete if exists
        await fetch(SUPA_URL + '/rest/v1/company_service_prices?company_id=eq.' + window._companyId + '&service_type=eq.' + encodeURIComponent(svc), {
          method: 'DELETE', headers: _authHeaders()
        });
        continue;
      }
      
      // Upsert
      await fetch(SUPA_URL + '/rest/v1/company_service_prices', {
        method: 'POST',
        headers: Object.assign({}, _authHeaders(), {'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal'}),
        body: JSON.stringify({ company_id: window._companyId, service_type: svc, price: price, price_type: priceType, updated_at: new Date().toISOString() })
      });
    }
    showToast('F\\u00f6retagspriser sparade!');
  } catch(e) {
    showToast('Kunde inte spara: ' + e.message);
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Spara priser'; }
}

setTimeout(function() { if (window._isCompanyOwner) loadCompanyPrices(); }, 1800);
`;
  dash = dash.replace(afterRating, afterRating + companyPricesJS);
  fixes++;
  console.log("1a. Company prices JS added - OK");
}

// Add HTML section for company prices in team tab
const ratingToggleHTML = "Betygsvisning";
const ratingIdx = dash.indexOf(ratingToggleHTML);
if (ratingIdx > -1) {
  // Find the end of the rating toggle card
  const afterRatingCard = dash.indexOf('</div>', dash.indexOf('rating-toggle-desc') + 50);
  // Find a good insertion point after the rating section
  const insertAfter = dash.indexOf('</div>', afterRatingCard + 6);
  const insertAfter2 = dash.indexOf('</div>', insertAfter + 6);
  const insertAfter3 = dash.indexOf('</div>', insertAfter2 + 6);
  
  // Actually, let's find the company profile card and add after it
  const companyHeader = dash.indexOf('Haghighi Consulting AB');
  // Better: find by the rating section specifically
  const ratingSection = dash.indexOf('Betygsvisning</div>');
  if (ratingSection > -1) {
    // Find the end of the rating section's parent card
    const ratingCardEnd = dash.indexOf('</div>', ratingSection + 100);
    const ratingCardEnd2 = dash.indexOf('</div>', ratingCardEnd + 6);
    
    const pricesHTML = `
    <div style="background:var(--w);border:1px solid var(--gray-200);border-radius:12px;padding:16px;margin-top:12px" id="company-prices-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-weight:600;font-size:.92rem">F\u00f6retagspriser</div>
          <div style="font-size:.72rem;color:var(--m);margin-top:2px">Standardpriser f\u00f6r alla st\u00e4dare (kan \u00f6verskrivas per person)</div>
        </div>
      </div>
      <div id="company-prices-list" style="margin-bottom:12px">
        <div style="font-size:.75rem;color:var(--gray-400)">Laddar priser...</div>
      </div>
      <button id="save-company-prices-btn" onclick="saveCompanyPrices()" style="width:100%;padding:10px;background:var(--g);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer">Spara priser</button>
    </div>`;
    
    // Insert after rating toggle section  
    dash = dash.substring(0, ratingCardEnd2 + 6) + pricesHTML + dash.substring(ratingCardEnd2 + 6);
    fixes++;
    console.log("1b. Company prices HTML added - OK");
  }
}

fs.writeFileSync(dashPath, dash, "utf8");

// ═══ 2. BOKA.HTML — Pris-resolution: individpris → företagspris → hourly_rate ═══
const bokaPath = "C:\\Users\\farha\\spick\\boka.html";
let boka = fs.readFileSync(bokaPath, "utf8");

// Fetch company_service_prices when company is detected
const companyDataStore = "window.companyShowIndividualRatings = rows[0].show_individual_ratings !== false;";
if (boka.includes(companyDataStore)) {
  boka = boka.replace(companyDataStore, `window.companyShowIndividualRatings = rows[0].show_individual_ratings !== false;
          // Fetch company-level prices
          fetch(SUPA + '/rest/v1/company_service_prices?company_id=eq.' + window.preCompanyId, {headers: H})
            .then(function(r){return r.json()})
            .then(function(cp){
              window.companyPrices = {};
              (cp||[]).forEach(function(p){ window.companyPrices[p.service_type] = p; });
              console.log('[SPICK] Company prices loaded:', Object.keys(window.companyPrices).length);
            }).catch(function(e){console.warn('[SPICK] Company prices fetch failed:', e);});`);
  fixes++;
  console.log("2a. Company prices fetch in boka.html - OK");
}

// Modify price display to use company prices as fallback
// Find where cleaner service prices are looked up
const priceLookup = "var sp = cl._servicePrices && cl._servicePrices.find(function(p) { return p.service_type === state.service; });";
if (boka.includes(priceLookup)) {
  const newLookup = `var _primarySvc = (state.services && state.services.length) ? state.services[0] : state.service;
        var sp = cl._servicePrices && cl._servicePrices.find(function(p) { return p.service_type === _primarySvc; });
        // Lager 2 fallback: company price
        if (!sp && window.companyPrices && window.companyPrices[_primarySvc]) {
          sp = window.companyPrices[_primarySvc];
        }`;
  // Replace ALL occurrences
  boka = boka.split(priceLookup).join(newLookup);
  fixes++;
  console.log("2b. Price resolution with company fallback - OK (all occurrences)");
}

fs.writeFileSync(bokaPath, boka, "utf8");

// ═══ 3. FORETAG.HTML — Visa företagspriser ═══
const foPath = "C:\\Users\\farha\\spick\\foretag.html";
let fo = fs.readFileSync(foPath, "utf8");

// Fetch company_service_prices alongside other data
const afterSvcPrices = "var svcPrices = [];";
if (fo.includes(afterSvcPrices)) {
  fo = fo.replace(afterSvcPrices, `var svcPrices = [];
    // Fetch company-level prices
    var companyPrices = {};
    try {
      var cpr = await fetch(SU + '/rest/v1/company_service_prices?company_id=eq.' + co.id, { headers: H });
      var cpData = await cpr.json() || [];
      cpData.forEach(function(p) { companyPrices[p.service_type] = p; });
    } catch(e) {}`);
  fixes++;
  console.log("3a. Company prices fetch in foretag.html - OK");
}

// Use company prices in service cards (fallback)
const svcMapFallback = "active.forEach(function(m) {";
const svcMapIdx = fo.indexOf(svcMapFallback, fo.indexOf("svcMap"));
if (svcMapIdx > -1) {
  // After the individual price loop, add company prices
  const afterSvcMap = fo.indexOf("var uniqueServices", svcMapIdx);
  if (afterSvcMap > -1) {
    const companyPriceFallback = `// Add company prices as fallback for services without individual prices
    Object.keys(companyPrices).forEach(function(svc) {
      if (!svcMap[svc]) {
        svcMap[svc] = { service_type: svc, price: companyPrices[svc].price, price_type: companyPrices[svc].price_type };
      }
    });
    `;
    fo = fo.substring(0, afterSvcMap) + companyPriceFallback + fo.substring(afterSvcMap);
    fixes++;
    console.log("3b. Company prices as fallback in service cards - OK");
  }
}

fs.writeFileSync(foPath, fo, "utf8");

// ═══ SUMMARY ═══
console.log("\n--- SUMMARY ---");
const finalDash = fs.readFileSync(dashPath, "utf8");
const finalBoka = fs.readFileSync(bokaPath, "utf8");
const finalFo = fs.readFileSync(foPath, "utf8");

console.log("Dashboard - company prices UI:", finalDash.includes("company-prices-list"));
console.log("Dashboard - saveCompanyPrices:", finalDash.includes("saveCompanyPrices"));
console.log("Boka - company prices fetch:", finalBoka.includes("companyPrices"));
console.log("Boka - price fallback:", finalBoka.includes("window.companyPrices"));
console.log("Foretag - company prices:", finalFo.includes("company_service_prices"));
console.log("Fixes:", fixes);
console.log(fixes >= 4 ? "SUCCESS" : "PARTIAL");
