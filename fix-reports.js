const fs = require("fs");
const filepath = "C:\\Users\\farha\\spick\\stadare-dashboard.html";
let c = fs.readFileSync(filepath, "utf8");

// ── 1. ADD REPORTS HTML after team-stats-card ──
const anchor = `<div class="card" style="padding:20px;margin-top:12px" id="team-reviews-card">`;
if (!c.includes(anchor)) {
  console.error("ERROR: Could not find team-reviews-card anchor");
  process.exit(1);
}

const reportsHTML = `
        <!-- ═══ VD-RAPPORTER ═══ -->
        <div class="card" style="padding:20px;margin-top:12px" id="team-reports-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h4 style="font-size:.95rem;font-weight:700;margin:0">📊 Rapporter</h4>
            <select id="report-period" onchange="loadReports()" style="padding:6px 12px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:.78rem;font-family:inherit;background:var(--w)">
              <option value="4">Senaste 4 veckorna</option>
              <option value="8">Senaste 8 veckorna</option>
              <option value="12">Senaste 12 veckorna</option>
            </select>
          </div>

          <!-- Omsättning per vecka -->
          <div style="margin-bottom:20px">
            <div style="font-size:.82rem;font-weight:600;margin-bottom:8px;color:var(--gray-700)">Omsättning per vecka</div>
            <div id="report-weekly-chart" style="display:flex;align-items:flex-end;gap:4px;height:120px;padding:8px 0;border-bottom:1px solid var(--gray-200)"></div>
          </div>

          <!-- Omsättning per städare -->
          <div style="margin-bottom:20px">
            <div style="font-size:.82rem;font-weight:600;margin-bottom:8px;color:var(--gray-700)">Omsättning per städare</div>
            <div id="report-per-cleaner" style="font-size:.82rem"></div>
          </div>

          <!-- Omsättning per tjänst -->
          <div>
            <div style="font-size:.82rem;font-weight:600;margin-bottom:8px;color:var(--gray-700)">Omsättning per tjänst</div>
            <div id="report-per-service" style="font-size:.82rem"></div>
          </div>
        </div>

`;

c = c.replace(anchor, reportsHTML + '        ' + anchor);

// ── 2. ADD REPORTS JS before the closing </script> ──
// Find the last </script> in the file
const lastScriptClose = c.lastIndexOf('</script>');
if (lastScriptClose === -1) {
  console.error("ERROR: Could not find </script>");
  process.exit(1);
}

const reportsJS = `

// ═══ VD-RAPPORTER ═══════════════════════════════════════════════
async function loadReports() {
  if (!window._isCompanyOwner) return;
  var weeks = parseInt(document.getElementById('report-period')?.value || '4');
  var since = new Date();
  since.setDate(since.getDate() - weeks * 7);
  var sinceStr = since.toISOString().split('T')[0];

  try {
    // Hämta alla betalda/klara bokningar för företaget
    var companyCleanerIds = (window._teamCleaners || []).map(function(c) { return c.id; });
    if (companyCleanerIds.length === 0) return;

    var url = SUPA + '/rest/v1/bookings?select=id,cleaner_id,cleaner_name,service_type,total_price,booking_date,booking_hours,rut_amount,commission_pct,spick_gross_sek' +
      '&cleaner_id=in.(' + companyCleanerIds.join(',') + ')' +
      '&payment_status=eq.paid' +
      '&booking_date=gte.' + sinceStr +
      '&order=booking_date.asc';

    var res = await fetch(url, { headers: H });
    var bookings = await res.json();
    if (!Array.isArray(bookings)) return;

    renderWeeklyChart(bookings, weeks);
    renderPerCleaner(bookings);
    renderPerService(bookings);
  } catch (e) {
    console.warn('loadReports error:', e);
  }
}

function getWeekNumber(dateStr) {
  var d = new Date(dateStr);
  var start = new Date(d.getFullYear(), 0, 1);
  var diff = (d - start + (start.getTimezoneOffset() - d.getTimezoneOffset()) * 60000) / 86400000;
  return 'v' + Math.ceil((diff + start.getDay() + 1) / 7);
}

function renderWeeklyChart(bookings, weekCount) {
  var byWeek = {};
  bookings.forEach(function(b) {
    var w = getWeekNumber(b.booking_date);
    byWeek[w] = (byWeek[w] || 0) + (b.total_price || 0);
  });

  var weeks = Object.keys(byWeek).slice(-weekCount);
  var maxVal = Math.max.apply(null, weeks.map(function(w) { return byWeek[w]; }).concat([1]));
  var container = document.getElementById('report-weekly-chart');
  if (!container) return;

  container.innerHTML = weeks.map(function(w) {
    var val = byWeek[w] || 0;
    var h = Math.max(4, Math.round((val / maxVal) * 100));
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">' +
      '<div style="font-size:.68rem;font-weight:600;color:var(--gray-700)">' + val.toLocaleString('sv') + ' kr</div>' +
      '<div style="width:100%;max-width:40px;height:' + h + 'px;background:var(--g);border-radius:4px 4px 0 0;transition:height .3s"></div>' +
      '<div style="font-size:.65rem;color:var(--m)">' + w + '</div>' +
      '</div>';
  }).join('');

  if (weeks.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--m);font-size:.82rem;padding:20px">Inga bokningar under perioden</div>';
  }
}

function renderPerCleaner(bookings) {
  var byCleaner = {};
  bookings.forEach(function(b) {
    var name = b.cleaner_name || 'Okänd';
    if (!byCleaner[name]) byCleaner[name] = { revenue: 0, jobs: 0, hours: 0 };
    byCleaner[name].revenue += (b.total_price || 0);
    byCleaner[name].jobs += 1;
    byCleaner[name].hours += (b.booking_hours || 0);
  });

  var sorted = Object.keys(byCleaner).sort(function(a, b) { return byCleaner[b].revenue - byCleaner[a].revenue; });
  var maxRev = sorted.length > 0 ? byCleaner[sorted[0]].revenue : 1;
  var container = document.getElementById('report-per-cleaner');
  if (!container) return;

  container.innerHTML = sorted.map(function(name) {
    var d = byCleaner[name];
    var pct = Math.round((d.revenue / maxRev) * 100);
    return '<div style="margin-bottom:10px">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:3px">' +
        '<span style="font-weight:600">' + name + '</span>' +
        '<span style="color:var(--g);font-weight:700">' + d.revenue.toLocaleString('sv') + ' kr</span>' +
      '</div>' +
      '<div style="background:var(--gray-100);border-radius:4px;height:8px;overflow:hidden">' +
        '<div style="width:' + pct + '%;height:100%;background:var(--g);border-radius:4px;transition:width .3s"></div>' +
      '</div>' +
      '<div style="font-size:.72rem;color:var(--m);margin-top:2px">' + d.jobs + ' jobb · ' + d.hours + ' timmar</div>' +
      '</div>';
  }).join('');

  if (sorted.length === 0) {
    container.innerHTML = '<div style="color:var(--m)">Inga data</div>';
  }
}

function renderPerService(bookings) {
  var byService = {};
  bookings.forEach(function(b) {
    var svc = b.service_type || 'Övrigt';
    if (!byService[svc]) byService[svc] = { revenue: 0, jobs: 0 };
    byService[svc].revenue += (b.total_price || 0);
    byService[svc].jobs += 1;
  });

  var sorted = Object.keys(byService).sort(function(a, b) { return byService[b].revenue - byService[a].revenue; });
  var totalRev = sorted.reduce(function(s, k) { return s + byService[k].revenue; }, 0) || 1;
  var colors = ['#0F6E56', '#10B981', '#6EE7B7', '#A7F3D0', '#D1FAE5'];
  var container = document.getElementById('report-per-service');
  if (!container) return;

  // Stacked bar
  var barHTML = '<div style="display:flex;height:24px;border-radius:6px;overflow:hidden;margin-bottom:10px">';
  sorted.forEach(function(svc, i) {
    var pct = Math.round((byService[svc].revenue / totalRev) * 100);
    barHTML += '<div style="width:' + pct + '%;background:' + (colors[i % colors.length]) + ';min-width:' + (pct > 5 ? '0' : '8px') + '" title="' + svc + ': ' + pct + '%"></div>';
  });
  barHTML += '</div>';

  // Legend
  var legendHTML = sorted.map(function(svc, i) {
    var d = byService[svc];
    var pct = Math.round((d.revenue / totalRev) * 100);
    return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">' +
      '<div style="width:10px;height:10px;border-radius:2px;background:' + (colors[i % colors.length]) + ';flex-shrink:0"></div>' +
      '<span style="flex:1">' + svc + '</span>' +
      '<span style="font-weight:600">' + d.revenue.toLocaleString('sv') + ' kr</span>' +
      '<span style="color:var(--m);font-size:.75rem;min-width:40px;text-align:right">' + pct + '%</span>' +
      '</div>';
  }).join('');

  container.innerHTML = barHTML + legendHTML;

  if (sorted.length === 0) {
    container.innerHTML = '<div style="color:var(--m)">Inga data</div>';
  }
}

// Auto-load reports when team tab opens
var _origSwitchTab = typeof switchTab === 'function' ? switchTab : null;
if (_origSwitchTab) {
  switchTab = function(tab) {
    _origSwitchTab(tab);
    if (tab === 'team') setTimeout(loadReports, 300);
  };
}
// Also load on initial team load
setTimeout(function() { if (window._isCompanyOwner) loadReports(); }, 2000);

`;

c = c.substring(0, lastScriptClose) + reportsJS + c.substring(lastScriptClose);

// ── 3. Store team cleaners for report queries ──
// Add _teamCleaners capture where team members are loaded
if (!c.includes('window._teamCleaners')) {
  // Find where team members are loaded
  const teamLoadAnchor = c.indexOf('team-count');
  if (teamLoadAnchor > -1) {
    // Look for where cleaners array is set in team loading code
    // We need to find the team loading function
    const teamListSet = c.indexOf("document.getElementById('team-list')");
    if (teamListSet > -1) {
      // Find the nearest function that sets team data
      // Add a global capture after team data is fetched
      // Search for pattern where team cleaners are stored
      const teamDataPattern = "teamMembers";
      const tmIdx = c.indexOf(teamDataPattern);
      if (tmIdx > -1) {
        // Find the assignment
        const lineStart = c.lastIndexOf('\n', tmIdx);
        const line = c.substring(lineStart, c.indexOf('\n', tmIdx));
        console.log("Found teamMembers reference at:", tmIdx);
      }
    }
  }

  // Alternative: inject at loadReports to query cleaners directly
  // The loadReports function already handles this by using window._teamCleaners
  // We need to make sure it's populated. Let's add a simple population step.
  const teamFetchAnchor = "id='team-list'";
  console.log("NOTE: window._teamCleaners must be set by existing team-loading code.");
  console.log("Adding fallback fetch in loadReports...");

  // Modify loadReports to fetch team cleaners if not cached
  c = c.replace(
    "var companyCleanerIds = (window._teamCleaners || []).map(function(c) { return c.id; });",
    `var companyCleanerIds = (window._teamCleaners || []).map(function(c) { return c.id; });
    if (companyCleanerIds.length === 0 && window._companyId) {
      try {
        var tcRes = await fetch(SUPA + '/rest/v1/cleaners?select=id&company_id=eq.' + window._companyId + '&is_approved=eq.true', { headers: H });
        var tcData = await tcRes.json();
        if (Array.isArray(tcData)) {
          window._teamCleaners = tcData;
          companyCleanerIds = tcData.map(function(c) { return c.id; });
        }
      } catch(e) { console.warn('Team cleaner fetch:', e); }
    }`
  );
}

fs.writeFileSync(filepath, c, "utf8");

// Verify
const final = fs.readFileSync(filepath, "utf8");
console.log("Reports HTML added:", final.includes("team-reports-card"));
console.log("Reports JS added:", final.includes("loadReports"));
console.log("Weekly chart:", final.includes("renderWeeklyChart"));
console.log("Per cleaner:", final.includes("renderPerCleaner"));
console.log("Per service:", final.includes("renderPerService"));
console.log(final.includes("team-reports-card") && final.includes("loadReports") ? "SUCCESS" : "FAILED");
