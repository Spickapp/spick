const fs = require("fs");
let fixes = 0;

// ═══ BOKA.HTML ═══
const bokaPath = "C:\\Users\\farha\\spick\\boka.html";
let boka = fs.readFileSync(bokaPath, "utf8");

// 1. Add new B2B service buttons after Kontorsstädning button
const kontorBtn = `<button class="svc-btn" onclick="selectService('Kontorsstädning','🏢','Daglig eller veckovis','2-6h')" data-svc="Kontorsstädning" id="svc-kontor"`;
const kontorIdx = boka.indexOf(kontorBtn);
if (kontorIdx > -1) {
  // Find the end of the Kontorsstädning button (closing </button>)
  const kontorEnd = boka.indexOf('</button>', kontorIdx) + '</button>'.length;
  
  const newButtons = `
          <button class="svc-btn" onclick="selectService('Trappstädning','🪜','BRF &amp; fastigheter','2-4h')" data-svc="Trappstädning" id="svc-trapp" style="display:none">
            <span class="svc-icon">🪜</span>
            <span class="svc-name">Trappstädning</span>
            <span class="svc-desc">BRF & fastigheter · 2-4h</span>
          </button>
          <button class="svc-btn" onclick="selectService('Skolstädning','🏫','Skolor &amp; förskolor','3-6h')" data-svc="Skolstädning" id="svc-skola" style="display:none">
            <span class="svc-icon">🏫</span>
            <span class="svc-name">Skolstädning</span>
            <span class="svc-desc">Skolor & förskolor · 3-6h</span>
          </button>
          <button class="svc-btn" onclick="selectService('Vårdstädning','🏥','Vårdlokaler &amp; kliniker','3-6h')" data-svc="Vårdstädning" id="svc-vard" style="display:none">
            <span class="svc-icon">🏥</span>
            <span class="svc-name">Vårdstädning</span>
            <span class="svc-desc">Vårdlokaler & kliniker · 3-6h</span>
          </button>
          <button class="svc-btn" onclick="selectService('Hotell &amp; restaurang','🏨','Hotell &amp; restauranger','2-6h')" data-svc="Hotell &amp; restaurang" id="svc-hotell" style="display:none">
            <span class="svc-icon">🏨</span>
            <span class="svc-name">Hotell & restaurang</span>
            <span class="svc-desc">Hotell & restauranger · 2-6h</span>
          </button>`;
  
  boka = boka.substring(0, kontorEnd) + newButtons + boka.substring(kontorEnd);
  fixes++;
  console.log("1. B2B service buttons added - OK");
} else {
  console.log("1. SKIP - Kontorsstädning button not found");
}

// 2. Show/hide B2B buttons in customerType toggle
// Find where kontorBtn is shown for företag
const showKontor = "if (kontorBtn) kontorBtn.style.display = '';";
if (boka.includes(showKontor)) {
  boka = boka.replace(showKontor, 
    `if (kontorBtn) kontorBtn.style.display = '';
    var trappBtn = document.getElementById('svc-trapp'); if (trappBtn) trappBtn.style.display = '';
    var skolaBtn = document.getElementById('svc-skola'); if (skolaBtn) skolaBtn.style.display = '';
    var vardBtn = document.getElementById('svc-vard'); if (vardBtn) vardBtn.style.display = '';
    var hotellBtn = document.getElementById('svc-hotell'); if (hotellBtn) hotellBtn.style.display = '';`);
  fixes++;
  console.log("2a. B2B buttons shown for företag - OK");
}

// Hide B2B buttons for privat
const hideKontor = "if (kontorBtn) kontorBtn.style.display = 'none';";
if (boka.includes(hideKontor)) {
  boka = boka.replace(hideKontor,
    `if (kontorBtn) kontorBtn.style.display = 'none';
    var trappBtn2 = document.getElementById('svc-trapp'); if (trappBtn2) trappBtn2.style.display = 'none';
    var skolaBtn2 = document.getElementById('svc-skola'); if (skolaBtn2) skolaBtn2.style.display = 'none';
    var vardBtn2 = document.getElementById('svc-vard'); if (vardBtn2) vardBtn2.style.display = 'none';
    var hotellBtn2 = document.getElementById('svc-hotell'); if (hotellBtn2) hotellBtn2.style.display = 'none';`);
  fixes++;
  console.log("2b. B2B buttons hidden for privat - OK");
}

// 3. Add serviceDetails for new services
const detailsAnchor = "'Kontorsstädning': {";
const detailsIdx = boka.indexOf(detailsAnchor);
if (detailsIdx > -1) {
  // Find the end of Kontorsstädning details block
  const kontorDetailEnd = boka.indexOf("},", detailsIdx) + 2;
  
  const newDetails = `
  'Trappstädning': {
    items: ['Entré sopat och moppat','Trappor dammsugt och moppat','Räcken och ledstänger avtorkade','Dörrar och dörrhandtag rengjorda','Fönster i trapphus','Brevlådeområde rengjort'],
    note: 'Anpassas efter fastighetens storlek och antal våningar.'
  },
  'Skolstädning': {
    items: ['Klassrum — golv, bänkar, stolar','Korridorer dammsugt och moppat','Toaletter rengjorda och påfyllda','Matsal/kök rengjort','Kontaktytor desinficerade','Papperskorgar tömda'],
    note: 'Anpassad efter skolans schema och verksamhet.'
  },
  'Vårdstädning': {
    items: ['Patientrum rengjort och desinficerat','Hygienutrymmen grundligt rengjorda','Kontaktytor desinficerade','Golv moppat med desinfektionsmedel','Väntrum rengjort','Avfall hanterat enligt rutiner'],
    note: 'Utförs enligt strikta hygienrutiner för vårdmiljöer.'
  },
  'Hotell & restaurang': {
    items: ['Lobby och reception rengjord','Matsal/restaurangyta rengjord','Köksnära ytor rengjorda','Gästtoaletter rengjorda och påfyllda','Golv dammsugt och moppat','Glaspartier och entré putsade'],
    note: 'Anpassas efter verksamhetens öppettider och gästflöde.'
  },`;

  boka = boka.substring(0, kontorDetailEnd) + newDetails + boka.substring(kontorDetailEnd);
  fixes++;
  console.log("3. Service details added - OK");
} else {
  console.log("3. SKIP - Kontorsstädning details not found");
}

// 4. Add hour calculation for new services
const kontorCalcAnchor = "else if (state.service === 'Kontorsstädning') {";
// Actually the new services should use similar calculation to Kontorsstädning
// We need to handle them in calcHours. Find where _hasKontor is defined
const hasKontorLine = "var _hasKontor = _svcs.indexOf('Kontorsstädning') > -1;";
if (boka.includes(hasKontorLine)) {
  boka = boka.replace(hasKontorLine,
    `var _hasKontor = _svcs.indexOf('Kontorsstädning') > -1;
    var _hasTrapp = _svcs.indexOf('Trappstädning') > -1;
    var _hasSkola = _svcs.indexOf('Skolstädning') > -1;
    var _hasVard = _svcs.indexOf('Vårdstädning') > -1;
    var _hasHotell = _svcs.indexOf('Hotell & restaurang') > -1;
    var _hasB2B = _hasKontor || _hasTrapp || _hasSkola || _hasVard || _hasHotell;`);
  fixes++;
  console.log("4. Hour calculation variables added - OK");
}

// 5. Deselect new services when switching to privat
const deselectKontor = "if (state.service === 'Kontorsstädning') {";
if (boka.includes(deselectKontor)) {
  boka = boka.replace(deselectKontor,
    `if (state.service === 'Kontorsstädning' || state.service === 'Trappstädning' || state.service === 'Skolstädning' || state.service === 'Vårdstädning' || state.service === 'Hotell & restaurang' || (state.services && state.services.some(function(s){return ['Kontorsstädning','Trappstädning','Skolstädning','Vårdstädning','Hotell & restaurang'].indexOf(s)>-1}))) {
      state.services = [];`);
  fixes++;
  console.log("5. B2B deselect on privat switch - OK");
}

fs.writeFileSync(bokaPath, boka, "utf8");

// ═══ FORETAG.HTML ═══
const foPath = "C:\\Users\\farha\\spick\\foretag.html";
let fo = fs.readFileSync(foPath, "utf8");

// Add icons for new services
const iconMap = "var svcIcons = {";
if (fo.includes(iconMap)) {
  const oldIcons = "var svcIcons = {\n  'Hemstädning': '🏠', 'Storstädning': '✨', 'Flyttstädning': '📦',\n  'Fönsterputs': '🪟', 'Kontorsstädning': '🏢', 'Trappstädning': '🪜'\n};";
  const newIcons = "var svcIcons = {\n  'Hemstädning': '🏠', 'Storstädning': '✨', 'Flyttstädning': '📦',\n  'Fönsterputs': '🪟', 'Kontorsstädning': '🏢', 'Trappstädning': '🪜',\n  'Skolstädning': '🏫', 'Vårdstädning': '🏥', 'Hotell & restaurang': '🏨'\n};";
  
  if (fo.includes(oldIcons)) {
    fo = fo.replace(oldIcons, newIcons);
    fixes++;
    console.log("6a. Foretag icons updated - OK");
  } else {
    // Try simpler replacement
    const simpleOldIcons = "'Trappstädning': '🪜'\n};";
    if (fo.includes(simpleOldIcons)) {
      fo = fo.replace(simpleOldIcons, "'Trappstädning': '🪜',\n  'Skolstädning': '🏫', 'Vårdstädning': '🏥', 'Hotell & restaurang': '🏨'\n};");
      fixes++;
      console.log("6a. Foretag icons updated (simple match) - OK");
    } else {
      console.log("6a. SKIP - icon map not found for update");
    }
  }
}

// Add service descriptions for new services
const descMap = "var svcDescs = {";
if (fo.includes(descMap)) {
  const oldTrappDesc = "'Trappstädning': 'Rena trapphus och gemensamma utrymmen.'";
  if (fo.includes(oldTrappDesc)) {
    fo = fo.replace(oldTrappDesc,
      "'Trappstädning': 'Rena trapphus och gemensamma utrymmen.',\n  'Skolstädning': 'Professionell städning för skolor och förskolor med fokus på hygien.',\n  'Vårdstädning': 'Städning av vårdlokaler med strikta hygienkrav.',\n  'Hotell & restaurang': 'Professionell städservice för hotell och restauranger.'");
    fixes++;
    console.log("6b. Foretag descriptions updated - OK");
  } else {
    console.log("6b. SKIP - Trappstädning desc not found");
  }
}

fs.writeFileSync(foPath, fo, "utf8");

// ═══ SUMMARY ═══
console.log("\n--- SUMMARY ---");
console.log("Fixes applied:", fixes);
const finalBoka = fs.readFileSync(bokaPath, "utf8");
console.log("boka has Trappstädning btn:", finalBoka.includes("svc-trapp"));
console.log("boka has Skolstädning btn:", finalBoka.includes("svc-skola"));
console.log("boka has Vårdstädning btn:", finalBoka.includes("svc-vard"));
console.log("boka has Hotell btn:", finalBoka.includes("svc-hotell"));
console.log("boka has B2B details:", finalBoka.includes("'Trappstädning':"));
console.log(fixes >= 5 ? "SUCCESS" : "PARTIAL - check logs");
