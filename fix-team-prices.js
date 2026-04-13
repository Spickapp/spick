const fs = require("fs");
const fp = "C:\\Users\\farha\\spick\\stadare-dashboard.html";
let c = fs.readFileSync(fp, "utf8");
let fixes = 0;

// ═══ 1. Replace the slider HTML with dynamic price container ═══
const oldSlider = `      <!-- F\u00e4lt 6: Timpris -->
      <div class="tm-form-group">
        <label>Timpris <span id="team-rate-val" style="color:var(--spick-500);font-weight:600">350 kr/h</span></label>
        <input type="range" id="team-rate" min="200" max="600" value="350" step="10"
          oninput="document.getElementById('team-rate-val').textContent=this.value+' kr/h'"
          style="width:100%">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gray-400);margin-top:4px">
          <span>200 kr/h</span><span>600 kr/h</span>
        </div>
      </div>`;

const newPriceSection = `      <!-- F\u00e4lt 6: Priser per tj\u00e4nst -->
      <div class="tm-form-group">
        <label>Priser per tj\u00e4nst</label>
        <div id="team-svc-prices" style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
          <div style="font-size:.75rem;color:var(--gray-400);font-style:italic">V\u00e4lj tj\u00e4nster ovan f\u00f6r att s\u00e4tta priser</div>
        </div>
        <input type="hidden" id="team-rate" value="350">
      </div>`;

if (c.includes(oldSlider)) {
  c = c.replace(oldSlider, newPriceSection);
  fixes++;
  console.log("1. Slider replaced with per-service prices - OK");
} else {
  console.log("1. SKIP - slider HTML not found exactly");
  // Try partial match
  const partialOld = '<!-- F\u00e4lt 6: Timpris -->';
  if (c.includes(partialOld)) {
    const startIdx = c.indexOf(partialOld);
    const endIdx = c.indexOf('</div>\n      </div>', startIdx + 50);
    if (endIdx > -1) {
      c = c.substring(0, startIdx) + newPriceSection + c.substring(endIdx + '</div>\n      </div>'.length);
      fixes++;
      console.log("1. Slider replaced (partial match) - OK");
    }
  }
}

// ═══ 2. Modify toggleTeamSvc to update price fields ═══
const oldToggle = "function toggleTeamSvc(btn) {";
if (c.includes(oldToggle)) {
  // Find the full function
  const toggleIdx = c.indexOf(oldToggle);
  const toggleEnd = c.indexOf('\n}', toggleIdx) + 2;
  const oldToggleFn = c.substring(toggleIdx, toggleEnd);
  
  const newToggleFn = `function toggleTeamSvc(btn) {
  btn.classList.toggle('active');
  updateTeamSvcPrices();
}

function updateTeamSvcPrices() {
  var container = document.getElementById('team-svc-prices');
  if (!container) return;
  var selected = [];
  document.querySelectorAll('#team-services .tm-chip.active').forEach(function(b) {
    selected.push(b.dataset.svc);
  });
  if (!selected.length) {
    container.innerHTML = '<div style="font-size:.75rem;color:var(--gray-400);font-style:italic">V\\u00e4lj tj\\u00e4nster ovan f\\u00f6r att s\\u00e4tta priser</div>';
    document.getElementById('team-rate').value = 350;
    return;
  }
  var html = '';
  selected.forEach(function(svc) {
    var existing = container.querySelector('[data-price-svc="' + svc + '"]');
    var val = existing ? existing.querySelector('input[type=number]').value : '350';
    var type = existing ? existing.querySelector('select').value : 'hourly';
    html += '<div data-price-svc="' + svc + '" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#F9FAFB;border:1px solid var(--gray-200);border-radius:10px">';
    html += '<span style="flex:1;font-size:.82rem;font-weight:500">' + svc + '</span>';
    html += '<input type="number" min="100" max="1000" step="10" value="' + val + '" style="width:70px;padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;font-size:.82rem;text-align:right" onchange="recalcTeamRate()">';
    html += '<select style="padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:.75rem;background:#fff" onchange="recalcTeamRate()">';
    html += '<option value="hourly"' + (type === 'hourly' ? ' selected' : '') + '>kr/h</option>';
    html += '<option value="per_sqm"' + (type === 'per_sqm' ? ' selected' : '') + '>kr/kvm</option>';
    html += '</select>';
    html += '</div>';
  });
  container.innerHTML = html;
  recalcTeamRate();
}

function recalcTeamRate() {
  var prices = document.querySelectorAll('#team-svc-prices [data-price-svc] input[type=number]');
  if (!prices.length) return;
  var sum = 0, count = 0;
  prices.forEach(function(p) {
    var v = parseInt(p.value) || 350;
    var sel = p.parentElement.querySelector('select');
    if (sel && sel.value === 'hourly') { sum += v; count++; }
  });
  document.getElementById('team-rate').value = count > 0 ? Math.round(sum / count) : 350;
}`;

  c = c.substring(0, toggleIdx) + newToggleFn + c.substring(toggleEnd);
  fixes++;
  console.log("2. toggleTeamSvc updated with price fields - OK");
} else {
  console.log("2. SKIP - toggleTeamSvc not found");
}

// ═══ 3. Modify addTeamMember to collect service prices ═══
// After the application is submitted, we store prices for later
const afterSubmit = "showTeamMsg(fname + ' \u00e4r tillagd. Spick-admin godk\u00e4nner inom 24h, sedan f\u00e5r ' + fname + ' ett v\u00e4lkomstmejl.', false);";
if (c.includes(afterSubmit)) {
  const priceStorage = `showTeamMsg(fname + ' \u00e4r tillagd. Spick-admin godk\u00e4nner inom 24h, sedan f\u00e5r ' + fname + ' ett v\u00e4lkomstmejl.', false);

    // Spara per-tjänst-priser i application metadata
    try {
      var appRows = await res.json();
      var appId = appRows && appRows[0] ? appRows[0].id : null;
      if (appId) {
        var svcPriceData = [];
        document.querySelectorAll('#team-svc-prices [data-price-svc]').forEach(function(el) {
          var svcName = el.dataset.priceSvc;
          var price = parseInt(el.querySelector('input[type=number]').value) || 350;
          var priceType = el.querySelector('select').value || 'hourly';
          svcPriceData.push({ service_type: svcName, price: price, price_type: priceType });
        });
        if (svcPriceData.length) {
          // Spara i application notes för admin att se
          await fetch(SUPA_URL + '/rest/v1/cleaner_applications?id=eq.' + appId, {
            method: 'PATCH',
            headers: Object.assign({}, _authHeaders(), {'Content-Type': 'application/json', 'Prefer': 'return=minimal'}),
            body: JSON.stringify({ notes: 'Priser: ' + svcPriceData.map(function(p) { return p.service_type + ': ' + p.price + ' ' + (p.price_type === 'per_sqm' ? 'kr/kvm' : 'kr/h'); }).join(', ') })
          });
        }
      }
    } catch(pe) { console.warn('Price save note:', pe); }`;
  c = c.replace(afterSubmit, priceStorage);
  fixes++;
  console.log("3. addTeamMember saves price notes - OK");
} else {
  console.log("3. SKIP - submit message not found");
}

// ═══ 4. Edit modal: pre-populate service prices ═══
const editRateLine = "document.getElementById('team-rate').value = member.hourly_rate || 350;";
if (c.includes(editRateLine)) {
  c = c.replace(editRateLine, 
    `document.getElementById('team-rate').value = member.hourly_rate || 350;
    // Trigger price fields regeneration for edit mode
    setTimeout(function() { updateTeamSvcPrices(); }, 100);`);
  fixes++;
  console.log("4. Edit modal regenerates price fields - OK");
}

// ═══ 5. Reset function: clear prices ═══
const resetPhone = "document.getElementById('team-phone').value = '';";
if (c.includes(resetPhone)) {
  c = c.replace(resetPhone, 
    `document.getElementById('team-phone').value = '';
  var pc = document.getElementById('team-svc-prices');
  if (pc) pc.innerHTML = '<div style="font-size:.75rem;color:var(--gray-400);font-style:italic">V\\u00e4lj tj\\u00e4nster ovan f\\u00f6r att s\\u00e4tta priser</div>';`);
  fixes++;
  console.log("5. Reset clears price fields - OK");
}

// ═══ 6. Add B2B services to team modal chips (if missing) ═══
const lastChip = "data-svc=\"Kontorsst\u00e4dning\" onclick=\"toggleTeamSvc(this)\">Kontorsst\u00e4dning</button>";
if (c.includes(lastChip) && !c.includes("data-svc=\"Trappst\u00e4dning\" onclick=\"toggleTeamSvc")) {
  c = c.replace(lastChip, lastChip + '\n          <button type="button" class="tm-chip" data-svc="Trappst\u00e4dning" onclick="toggleTeamSvc(this)">Trappst\u00e4dning</button>\n          <button type="button" class="tm-chip" data-svc="Skolst\u00e4dning" onclick="toggleTeamSvc(this)">Skolst\u00e4dning</button>\n          <button type="button" class="tm-chip" data-svc="V\u00e5rdst\u00e4dning" onclick="toggleTeamSvc(this)">V\u00e5rdst\u00e4dning</button>\n          <button type="button" class="tm-chip" data-svc="Hotell &amp; restaurang" onclick="toggleTeamSvc(this)">Hotell &amp; restaurang</button>');
  fixes++;
  console.log("6. B2B service chips added to modal - OK");
}

fs.writeFileSync(fp, c, "utf8");

const final = fs.readFileSync(fp, "utf8");
console.log("\n--- VERIFY ---");
console.log("Price container:", final.includes("team-svc-prices"));
console.log("updateTeamSvcPrices:", final.includes("updateTeamSvcPrices"));
console.log("recalcTeamRate:", final.includes("recalcTeamRate"));
console.log("Price notes save:", final.includes("svcPriceData"));
console.log("Fixes:", fixes);
console.log(fixes >= 4 ? "SUCCESS" : "PARTIAL");
