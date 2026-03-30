/**
 * patch-upsell.js
 * 
 * Lägger till mjuka upsell-rader i "Vad ingår?"-panelen.
 * Uppdaterar serviceDetails-objektet och showServiceDetail-funktionen.
 * 
 * Kör: node patch-upsell.js
 */
const fs = require('fs');
let f = fs.readFileSync('boka.html', 'utf8');
const orig = f;

// ═══════════════════════════════════════════
// 1. CSS för upsell-raden
// ═══════════════════════════════════════════
const upsellCSS = '.svc-detail-upsell{font-size:12px;color:#555;margin-top:10px;padding-top:8px;border-top:.5px solid rgba(0,0,0,.08);font-style:italic}.svc-detail-upsell a{color:#0F6E56;font-weight:500;cursor:pointer;text-decoration:none;font-style:normal}.svc-detail-upsell a:hover{text-decoration:underline}';

if (!f.includes('svc-detail-upsell')) {
  f = f.replace('</style>\n</head>', upsellCSS + '\n</style>\n</head>');
  // Try alternate location if svc-detail-css style tag exists
  if (!f.includes('svc-detail-upsell')) {
    f = f.replace('id="svc-detail-css">', 'id="svc-detail-css">\n' + upsellCSS);
  }
  console.log('\x1b[32m\u2705 Upsell CSS tillagd\x1b[0m');
}

// ═══════════════════════════════════════════
// 2. Lägg till upsell-fält i serviceDetails
// ═══════════════════════════════════════════

// Hemstädning: upsell till Storstädning
const hemNote = "note: 'Perfekt som l";
const hemUpsell = "upsell: 'Beh\\u00f6ver du ugn, kyl & f\\u00f6nster?',upsellLink:'Storst\\u00e4dning',\n    note: 'Perfekt som l";
if (f.includes(hemNote) && !f.includes("upsell: 'Beh")) {
  f = f.replace(hemNote, hemUpsell);
  console.log('\x1b[32m\u2705 Hemstädning upsell tillagd\x1b[0m');
}

// Storstädning: upsell till Flyttstädning
const storNote = "note: 'Boka inf";
const storUpsell = "upsell: 'Ska du flytta? F\\u00e5 besiktningsgaranti.',upsellLink:'Flyttst\\u00e4dning',\n    note: 'Boka inf";
if (f.includes(storNote) && !f.includes("upsell: 'Ska du flytta")) {
  f = f.replace(storNote, storUpsell);
  console.log('\x1b[32m\u2705 Storstädning upsell tillagd\x1b[0m');
}

// ═══════════════════════════════════════════
// 3. Uppdatera showServiceDetail att rendera upsell
// ═══════════════════════════════════════════
const oldRender = "if (info.note) html += '<div class=\"svc-detail-note\">' + info.note + '</div>';";
const newRender = `if (info.upsell) {
    html += '<div class="svc-detail-upsell">' + info.upsell + ' <a onclick="document.querySelector(\\'.svc-btn[data-svc=\\x22' + info.upsellLink + '\\x22]\\').click()">V\\u00e4lj ' + info.upsellLink + ' \\u2192</a></div>';
  }
  if (info.note) html += '<div class="svc-detail-note">' + info.note + '</div>';`;

if (f.includes(oldRender)) {
  f = f.replace(oldRender, newRender);
  console.log('\x1b[32m\u2705 Render-logik uppdaterad\x1b[0m');
}

// ═══════════════════════════════════════════
// Spara
// ═══════════════════════════════════════════
if (f !== orig) {
  fs.writeFileSync('boka.html', f, 'utf8');
  console.log('\n\x1b[32m\ud83c\udf89 Upsell-patch klar!\x1b[0m');
} else {
  console.log('Ingen \u00e4ndring beh\u00f6vdes.');
}
