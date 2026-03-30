/**
 * patch-service-details.js
 * 
 * Lägger till:
 * 1. Bättre subtitlar på tjänstekorten
 * 2. Expanderbar "Vad ingår?"-panel under tjänstekorten
 * 3. CSS i egen <style> i <head>
 * 4. JS som hookar in i selectService()
 * 
 * Kör: node patch-service-details.js
 */
const fs = require('fs');
let f = fs.readFileSync('boka.html', 'utf8');
const orig = f;

// ═══════════════════════════════════════════
// 1. Uppdatera synliga subtitlar
// ═══════════════════════════════════════════
const subs = [
  ['Grundlig, 4\u20138h', 'Grundlig, hela hemmet \u00b7 4\u20138h'],
  ['In- eller utflyttning', 'Godkänd vid besiktning \u00b7 4\u201310h'],
  ['In- och utv\u00e4ndigt', 'In- & utv\u00e4ndigt \u00b7 fr\u00e5n 1h'],
  ['L\u00f6pande st\u00e4dning, 2\u20134h', 'L\u00f6pande st\u00e4dning \u00b7 2\u20134h'],
];
for (const [old, nw] of subs) {
  if (f.includes(old)) { f = f.split(old).join(nw); }
}

// ═══════════════════════════════════════════
// 2. CSS i egen <style> före </head>
// ═══════════════════════════════════════════
const css = `<style id="svc-detail-css">
#svc-detail{margin-top:12px;background:var(--bg2,#f8f8f6);border-radius:12px;padding:16px 20px;border:.5px solid rgba(0,0,0,.08);animation:svcFadeIn .2s ease}
@keyframes svcFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.svc-detail-title{font-weight:500;font-size:15px;margin-bottom:10px;color:var(--fg,#1c1c1a)}
.svc-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px}
.svc-detail-item{font-size:13px;color:#555;padding:3px 0}
.svc-detail-item::before{content:'\\2713 ';color:#0F6E56;font-weight:600;margin-right:4px}
.svc-detail-also{font-size:13px;font-weight:500;color:var(--fg,#1c1c1a);grid-column:1/-1;padding:6px 0 2px}
.svc-detail-also::before{content:none}
.svc-detail-note{font-size:12px;color:#0F6E56;margin-top:10px;padding-top:8px;border-top:.5px solid rgba(0,0,0,.08)}
@media(max-width:600px){.svc-detail-grid{grid-template-columns:1fr}}
</style>`;

if (!f.includes('svc-detail-css')) {
  f = f.replace('</head>', css + '\n</head>');
  console.log('\x1b[32m\u2705 CSS tillagd\x1b[0m');
}

// ═══════════════════════════════════════════
// 3. HTML — <div id="svc-detail"> efter 87%-raden
// ═══════════════════════════════════════════
if (!f.includes('id="svc-detail"')) {
  // Find the 87% social proof line end
  const marker = '87% av v\u00e5ra kunder';
  const idx = f.indexOf(marker);
  if (idx > -1) {
    // Find the closing </div> after this marker
    const closeDiv = f.indexOf('</div>', idx);
    if (closeDiv > -1) {
      const insertAt = closeDiv + 6; // after </div>
      f = f.substring(0, insertAt) + '\n          <div id="svc-detail"></div>' + f.substring(insertAt);
      console.log('\x1b[32m\u2705 Detail-div tillagd efter 87%-raden\x1b[0m');
    }
  } else {
    // Fallback: after svc-error
    const errIdx = f.indexOf('id="svc-error"');
    if (errIdx > -1) {
      const closeDiv = f.indexOf('</div>', errIdx);
      if (closeDiv > -1) {
        const insertAt = closeDiv + 6;
        f = f.substring(0, insertAt) + '\n          <div id="svc-detail"></div>' + f.substring(insertAt);
        console.log('\x1b[32m\u2705 Detail-div tillagd efter svc-error (fallback)\x1b[0m');
      }
    }
  }
}

// ═══════════════════════════════════════════
// 4. JS — serviceDetails data + hook
// ═══════════════════════════════════════════
const js = `

/* ── Service details panel ── */
var serviceDetails = {
  'Hemst\\u00e4dning': {
    items: ['Dammsugning & moppning alla golv','Badrum \\u2014 toalett, dusch, handfat, spegel','K\\u00f6k \\u2014 diskb\\u00e4nk, spis, b\\u00e4nkytor','Dammtorkning av fria ytor','T\\u00f6mning av papperskorgar','B\\u00e4ddning (om \\u00f6nskat)'],
    note: 'Perfekt som l\\u00f6pande st\\u00e4d varje eller varannan vecka.'
  },
  'Storst\\u00e4dning': {
    also: 'Allt i hemst\\u00e4dning, plus:',
    items: ['Insida av ugn & kyl/frys','Insida av sk\\u00e5p & garderober','Lister, d\\u00f6rrar & kontakter','F\\u00f6nsterbr\\u00e4dor & element','Bakom & under m\\u00f6bler','V\\u00e4ggar \\u2014 fl\\u00e4ckar & avtorkning'],
    note: 'Boka inf\\u00f6r h\\u00f6gtider, s\\u00e4songsbyten eller som eng\\u00e5ngsinsats.'
  },
  'Flyttst\\u00e4dning': {
    also: 'Allt i storst\\u00e4dning, plus:',
    items: ['Insida av alla sk\\u00e5p & l\\u00e5dor','Ugn, spis, kyl, frys \\u2014 grundligt','F\\u00f6nsterputs in- & utv\\u00e4ndigt','Avkalkning badrum','Golvlister & ventiler','Vitvaror \\u2014 utv\\u00e4ndigt & inv\\u00e4ndigt'],
    note: 'Vi f\\u00f6ljer m\\u00e4klarstandard \\u2014 du f\\u00e5r garanti p\\u00e5 besiktningen.'
  },
  'F\\u00f6nsterputs': {
    items: ['F\\u00f6nsterglas in- & utsida','F\\u00f6nsterkarmar & b\\u00e5gar','F\\u00f6nsterbr\\u00e4dor','Spr\\u00f6js (om till\\u00e4mpligt)'],
    note: 'Pris baseras p\\u00e5 antal f\\u00f6nster. Perfekt som till\\u00e4gg till hemst\\u00e4d.'
  }
};

function showServiceDetail(name) {
  var d = document.getElementById('svc-detail');
  if (!d) return;
  var info = serviceDetails[name];
  if (!info) { d.style.display = 'none'; return; }
  var html = '<div class="svc-detail-title">Vad ing\\u00e5r i ' + name.toLowerCase() + '?</div>';
  html += '<div class="svc-detail-grid">';
  if (info.also) html += '<div class="svc-detail-also">' + info.also + '</div>';
  for (var i = 0; i < info.items.length; i++) {
    html += '<div class="svc-detail-item">' + info.items[i] + '</div>';
  }
  html += '</div>';
  if (info.note) html += '<div class="svc-detail-note">' + info.note + '</div>';
  d.innerHTML = html;
  d.style.display = 'block';
}

(function() {
  var _real = window.selectService;
  if (_real) {
    window.selectService = function(name, icon, desc, dur) {
      _real(name, icon, desc, dur);
      showServiceDetail(name);
    };
  }
  showServiceDetail('Hemst\\u00e4dning');
})();
`;

if (!f.includes('serviceDetails')) {
  const insertPoint = f.lastIndexOf('</script>');
  if (insertPoint > -1) {
    f = f.substring(0, insertPoint) + js + '\n' + f.substring(insertPoint);
    console.log('\x1b[32m\u2705 JS tillagd\x1b[0m');
  }
}

// ═══════════════════════════════════════════
// Spara
// ═══════════════════════════════════════════
if (f !== orig) {
  fs.writeFileSync('boka.html', f, 'utf8');
  console.log('\n\x1b[32m\ud83c\udf89 Patch klar!\x1b[0m');
  console.log('Kör:');
  console.log('  git add boka.html');
  console.log('  git commit -m "feat: expanderbar vad-ingar-panel under tjanstekort"');
  console.log('  git push');
} else {
  console.log('Ingen ändring behövdes.');
}
