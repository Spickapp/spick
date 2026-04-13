const fs = require("fs");
let fixes = 0;

// ═══ 1. VD DASHBOARD — Toggle i team-inställningar ═══
const dashPath = "C:\\Users\\farha\\spick\\stadare-dashboard.html";
let dash = fs.readFileSync(dashPath, "utf8");

// Add toggle after company profile edit section
const profileAnchor = '<button onclick="cancelCompanyEdit()"';
if (dash.includes(profileAnchor)) {
  const insertPoint = dash.indexOf('</div>', dash.indexOf(profileAnchor) + 50);
  // Find the closing of company-profile-edit div
  const editEndIdx = dash.indexOf("</div>", insertPoint + 6);
  const cardEndIdx = dash.indexOf("</div>", editEndIdx + 6);
  
  const ratingToggleHTML = `
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--gray-200)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:600;font-size:.88rem">Betygsvisning</div>
              <div style="font-size:.75rem;color:var(--m);margin-top:2px" id="rating-toggle-desc">Varje städares betyg syns för kunder</div>
            </div>
            <label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer">
              <input type="checkbox" id="toggle-individual-ratings" checked onchange="toggleIndividualRatings(this.checked)" style="opacity:0;width:0;height:0">
              <span style="position:absolute;inset:0;background:#ccc;border-radius:24px;transition:.2s"></span>
              <span style="position:absolute;left:2px;top:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)" id="rating-toggle-knob"></span>
            </label>
          </div>
        </div>`;
  
  // Insert after the company profile card closes
  if (cardEndIdx > -1) {
    dash = dash.substring(0, cardEndIdx) + ratingToggleHTML + dash.substring(cardEndIdx);
    fixes++;
    console.log("1a. Rating toggle HTML added to dashboard - OK");
  }
}

// Add JS for the toggle
const lastScriptDash = dash.lastIndexOf('</script>');
if (lastScriptDash > -1) {
  const toggleJS = `
// ═══ RATING TOGGLE ═══
async function toggleIndividualRatings(checked) {
  if (!window._companyId) return;
  var desc = document.getElementById('rating-toggle-desc');
  var knob = document.getElementById('rating-toggle-knob');
  var track = knob ? knob.previousElementSibling : null;
  
  if (checked) {
    if (desc) desc.textContent = 'Varje st\\u00e4dares betyg syns f\\u00f6r kunder';
    if (knob) knob.style.left = '22px';
    if (track) track.style.background = 'var(--g)';
  } else {
    if (desc) desc.textContent = 'Bara f\\u00f6retagets totalbetyg syns f\\u00f6r kunder';
    if (knob) knob.style.left = '2px';
    if (track) track.style.background = '#ccc';
  }
  
  try {
    await fetch(SUPA + '/rest/v1/companies?id=eq.' + window._companyId, {
      method: 'PATCH',
      headers: Object.assign({}, H, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ show_individual_ratings: checked })
    });
    showToast(checked ? 'Individuella betyg visas' : 'Bara f\\u00f6retagsbetyg visas');
  } catch(e) { console.warn('Rating toggle error:', e); }
}

// Load rating toggle state
async function loadRatingToggle() {
  if (!window._companyId) return;
  try {
    var res = await fetch(SUPA + '/rest/v1/companies?id=eq.' + window._companyId + '&select=show_individual_ratings', { headers: H });
    var rows = await res.json();
    if (rows && rows[0]) {
      var checked = rows[0].show_individual_ratings !== false;
      var el = document.getElementById('toggle-individual-ratings');
      if (el) el.checked = checked;
      toggleIndividualRatings(checked);
    }
  } catch(e) {}
}
setTimeout(function() { if (window._isCompanyOwner) loadRatingToggle(); }, 1500);

`;
  dash = dash.substring(0, lastScriptDash) + toggleJS + dash.substring(lastScriptDash);
  fixes++;
  console.log("1b. Rating toggle JS added - OK");
}

// Add CSS for toggle switch
const styleEnd = dash.indexOf('</style>');
if (styleEnd > -1) {
  const toggleCSS = `
input:checked + span{background:var(--g)!important}
input:checked + span + #rating-toggle-knob{left:22px!important}
`;
  dash = dash.substring(0, styleEnd) + toggleCSS + dash.substring(styleEnd);
  fixes++;
  console.log("1c. Toggle CSS added - OK");
}

fs.writeFileSync(dashPath, dash, "utf8");

// ═══ 2. FORETAG.HTML — Respect show_individual_ratings ═══
const foPath = "C:\\Users\\farha\\spick\\foretag.html";
let fo = fs.readFileSync(foPath, "utf8");

// Company data is already fetched with select=*
// Add show_individual_ratings to the logic

// In hero stats, conditionally show avg rating
const heroStatsAnchor = "if (avgRating > 0) h += '<div><div class=\"hero-stat-val\">' + avgRating.toFixed(1)";
if (fo.includes(heroStatsAnchor)) {
  // This is fine as-is — always show company avg
  console.log("2a. Hero stats - OK (always shows company avg)");
  fixes++;
}

// In team cards, hide individual ratings if setting is false
const teamStarsAnchor = "if (rat > 0) h += '<div class=\"team-stars\">'";
if (fo.includes(teamStarsAnchor)) {
  const newTeamStars = "if (rat > 0 && co.show_individual_ratings !== false) h += '<div class=\"team-stars\">'";
  fo = fo.replace(teamStarsAnchor, newTeamStars);
  fixes++;
  console.log("2b. Team card stars hidden when toggle off - OK");
}

// In team meta (job count), also hide if setting is false
const teamMetaJobs = "h += '<div class=\"team-meta\">' + (m.completed_jobs || 0) + ' jobb</div>';";
if (fo.includes(teamMetaJobs)) {
  const newTeamMeta = "h += '<div class=\"team-meta\">' + (co.show_individual_ratings !== false ? (m.completed_jobs || 0) + ' jobb' : '') + '</div>';";
  fo = fo.replace(teamMetaJobs, newTeamMeta);
  fixes++;
  console.log("2c. Team card job count hidden when toggle off - OK");
}

fs.writeFileSync(foPath, fo, "utf8");

// ═══ 3. BOKA.HTML — Respect show_individual_ratings ═══
const bokaPath = "C:\\Users\\farha\\spick\\boka.html";
let boka = fs.readFileSync(bokaPath, "utf8");

// companyData is already fetched and stored in window.companyData
// We need to add show_individual_ratings to the fetch select
const companyFetchSelect = "select=id,name,display_name,allow_customer_choice,description";
if (boka.includes(companyFetchSelect)) {
  boka = boka.replace(companyFetchSelect, "select=id,name,display_name,allow_customer_choice,description,show_individual_ratings");
  fixes++;
  console.log("3a. Company fetch includes show_individual_ratings - OK");
}

// Store the setting
const companyDataStore = "window.companyAllowChoice = rows[0].allow_customer_choice !== false;";
if (boka.includes(companyDataStore)) {
  boka = boka.replace(companyDataStore, 
    "window.companyAllowChoice = rows[0].allow_customer_choice !== false;\n          window.companyShowIndividualRatings = rows[0].show_individual_ratings !== false;");
  fixes++;
  console.log("3b. show_individual_ratings stored - OK");
}

// In cleaner card rendering, hide individual rating if company says no
// Find where hasRatings is used in card rendering
const ratingDisplay = "hasRatings\n";
// More specific: find the star rendering in cleaner cards
const starRender = "${hasRatings";
// Let's find a more specific pattern
const avgRatingDisplay = "cl.avg_rating.toFixed(1)";
if (boka.includes(avgRatingDisplay)) {
  // The rating display is already there, we need to wrap it with company check
  // Find the ternary that shows rating vs "Ny på Spick"
  const ratingTernary = "${hasRatings\n";
  // Actually let me find the exact pattern
  const cardRatingCheck = "const hasRatings = cl.avg_rating != null && cl.review_count > 0;";
  if (boka.includes(cardRatingCheck)) {
    const newRatingCheck = "const hasRatings = cl.avg_rating != null && cl.review_count > 0 && (!(window.preCompanyId && window.companyShowIndividualRatings === false));";
    boka = boka.replace(cardRatingCheck, newRatingCheck);
    fixes++;
    console.log("3c. Cleaner card hides rating when company toggle off - OK");
  }
}

fs.writeFileSync(bokaPath, boka, "utf8");

// ═══ SUMMARY ═══
console.log("\n--- SUMMARY ---");
console.log("Fixes applied:", fixes);
const finalDash = fs.readFileSync(dashPath, "utf8");
const finalFo = fs.readFileSync(foPath, "utf8");
const finalBoka = fs.readFileSync(bokaPath, "utf8");

console.log("Dashboard toggle:", finalDash.includes("toggleIndividualRatings") ? "OK" : "MISSING");
console.log("Foretag respects:", finalFo.includes("show_individual_ratings !== false") ? "OK" : "MISSING");
console.log("Boka fetches setting:", finalBoka.includes("show_individual_ratings") ? "OK" : "MISSING");
console.log("Boka hides ratings:", finalBoka.includes("companyShowIndividualRatings === false") ? "OK" : "MISSING");

const allOk = finalDash.includes("toggleIndividualRatings") && finalFo.includes("show_individual_ratings") && finalBoka.includes("companyShowIndividualRatings");
console.log(allOk ? "\nSUCCESS" : "\nPARTIAL");
