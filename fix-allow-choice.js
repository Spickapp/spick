const fs = require("fs");
const filepath = "C:\\Users\\farha\\spick\\boka.html";
let c = fs.readFileSync(filepath, "utf8");

// ── FIX 1: Fetch company data (after preCompanyId is set, around line 720) ──
const anchor1 = "window.preCompanyId = p.get('company') || null;";
if (!c.includes(anchor1)) {
  console.error("ERROR: Could not find preCompanyId anchor");
  process.exit(1);
}

const companyFetch = `window.preCompanyId = p.get('company') || null;
  window.companyAllowChoice = true; // default
  if (window.preCompanyId) {
    fetch(SUPA + '/rest/v1/companies?select=id,name,display_name,allow_customer_choice,description&id=eq.' + window.preCompanyId, {headers: H})
      .then(r => r.json())
      .then(rows => {
        if (rows && rows.length > 0) {
          window.companyData = rows[0];
          window.companyAllowChoice = rows[0].allow_customer_choice !== false;
          console.log('[SPICK] Company allow_customer_choice:', window.companyAllowChoice);
        }
      })
      .catch(e => console.warn('[SPICK] Company fetch failed:', e));
  }`;

c = c.replace(anchor1, companyFetch);

// ── FIX 2: In renderCleaners, add company card mode ──
// Insert before the cleaners.forEach loop
const anchor2 = "cleaners.forEach(cl => {";
// Find the FIRST occurrence inside renderCleaners (after list.className = 'cleaner-list')
const renderStart = c.indexOf("list.className = 'cleaner-list';");
const forEachPos = c.indexOf(anchor2, renderStart);

if (forEachPos === -1) {
  console.error("ERROR: Could not find cleaners.forEach anchor");
  process.exit(1);
}

const companyCardLogic = `// ── ALLOW_CUSTOMER_CHOICE: visa företagskort om false ──
  if (preCompanyId && !window.companyAllowChoice && cleaners.length > 0) {
    var cd = window.companyData || {};
    var bestCleaner = cleaners[0]; // Already sorted by rating
    var compDisplayName = cd.display_name || cd.name || cleaners[0].company_display_name || cleaners[0].company_name || 'Företaget';
    var compDesc = cd.description || 'Vi tilldelar den bäst lämpade städaren för ditt jobb.';
    var avgRating = cleaners.reduce(function(s,c){return s+(c.avg_rating||0)},0) / cleaners.length;
    var totalReviews = cleaners.reduce(function(s,c){return s+(c.review_count||0)},0);
    var hasRatings = avgRating > 0 && totalReviews > 0;
    var svcPrice = bestCleaner._servicePrices && bestCleaner._servicePrices.find(function(p){return p.service_type===state.service});
    var rate = svcPrice ? svcPrice.price : (bestCleaner.hourly_rate || 350);
    var isPricePerSqm = svcPrice && svcPrice.price_type === 'per_sqm';
    var rutRate = Math.floor(rate * 0.5);
    var ini = compDisplayName.split(' ').map(function(w){return w[0]}).join('').slice(0,2).toUpperCase();
    var col = COLORS[compDisplayName.charCodeAt(0) % COLORS.length];

    var compCard = document.createElement('div');
    compCard.className = 'cleaner-card';
    compCard.innerHTML = '<div class="cleaner-av" style="background:' + col + '20;color:' + col + '">' + ini + '</div>' +
      '<div class="cleaner-info">' +
        '<div class="cleaner-name">' + escHtml(compDisplayName) + '</div>' +
        '<div class="cleaner-meta">' +
          (hasRatings ? '<span class="cleaner-stars">' + '★'.repeat(Math.round(avgRating)) + '</span> <span>' + avgRating.toFixed(1) + '</span> <span>(' + totalReviews + ' rec.)</span>' : '') +
          '<span>👥 ' + cleaners.length + ' städare</span>' +
        '</div>' +
        '<div style="font-size:.78rem;color:#6B7280;margin-top:.25rem">' + escHtml(compDesc) + '</div>' +
      '</div>' +
      '<div class="cleaner-badges">' +
        (isPricePerSqm
          ? (state.customerType === "privat"
            ? '<div class="cleaner-price">' + rutRate + ' kr/kvm</div><div class="cleaner-rut">efter RUT (' + rate + ' kr/kvm före)</div>'
            : '<div class="cleaner-price">' + rate + ' kr/kvm</div>')
          : (state.customerType === "privat"
            ? '<div class="cleaner-price">' + rutRate + ' kr/h</div><div class="cleaner-rut">inkl. RUT-avdrag</div>'
            : '<div class="cleaner-price">' + rate + ' kr/h</div>')) +
      '</div>';
    compCard.onclick = function() {
      // Auto-select best cleaner in background
      selectCleaner(bestCleaner, compCard);
    };
    list.appendChild(compCard);
    wrap.innerHTML = '';
    wrap.appendChild(list);
    return;
  }

  cleaners.forEach(cl => {`;

c = c.substring(0, forEachPos) + companyCardLogic + c.substring(forEachPos + anchor2.length);

fs.writeFileSync(filepath, c, "utf8");

// Verify
const final = fs.readFileSync(filepath, "utf8");
const hasAllowChoice = final.includes("companyAllowChoice");
const hasCompanyCard = final.includes("ALLOW_CUSTOMER_CHOICE");
console.log("allow_customer_choice logic added:", hasAllowChoice);
console.log("Company card rendering added:", hasCompanyCard);
console.log(hasAllowChoice && hasCompanyCard ? "SUCCESS" : "FAILED");
