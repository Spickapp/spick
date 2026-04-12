const fs = require('fs');
let fixes = 0;

// ═══════════════════════════════════════════════════
// boka.html — ALL FIXES
// ═══════════════════════════════════════════════════
let b = fs.readFileSync('boka.html', 'utf8');

// ─── FIX 1: Per-kvm pris visas korrekt i städarkort ───
// When isPricePerSqm but no sqm entered yet → show "X kr/kvm" not fallback to "kr/h"
const oldPriceDisplay = `          if (isPricePerSqm && state.sqm) {
            var total = rate * state.sqm;
            var totalRut = Math.round(total * 0.5);
            return state.customerType === 'privat'
              ? '<div class="cleaner-price">' + totalRut.toLocaleString('sv') + ' kr</div><div class="cleaner-rut">totalt efter RUT (' + total.toLocaleString('sv') + ' kr före)</div><div style="font-size:.68rem;color:var(--m)">' + rutRate + ' kr/kvm × ' + state.sqm + ' kvm</div>'
              : '<div class="cleaner-price">' + total.toLocaleString('sv') + ' kr</div><div class="cleaner-rut">totalt (' + rate + ' kr/kvm × ' + state.sqm + ' kvm)</div>';
          }
          return state.customerType === 'privat'
            ? '<div class="cleaner-price">' + rutRate + ' kr/h</div><div class="cleaner-rut">inkl. RUT-avdrag</div>'
            : '<div class="cleaner-price">' + rate + ' kr/h</div>';`;

const newPriceDisplay = `          if (isPricePerSqm && state.sqm) {
            var total = rate * state.sqm;
            var totalRut = Math.floor(total * 0.5);
            return state.customerType === 'privat'
              ? '<div class="cleaner-price">' + totalRut.toLocaleString('sv') + ' kr</div><div class="cleaner-rut">totalt efter RUT (' + total.toLocaleString('sv') + ' kr före)</div><div style="font-size:.68rem;color:var(--m)">' + rutRate + ' kr/kvm × ' + state.sqm + ' kvm</div>'
              : '<div class="cleaner-price">' + total.toLocaleString('sv') + ' kr</div><div class="cleaner-rut">totalt (' + rate + ' kr/kvm × ' + state.sqm + ' kvm)</div>';
          }
          if (isPricePerSqm) {
            return state.customerType === 'privat'
              ? '<div class="cleaner-price">' + rutRate + ' kr/kvm</div><div class="cleaner-rut">efter RUT (' + rate + ' kr/kvm före)</div>'
              : '<div class="cleaner-price">' + rate + ' kr/kvm</div>';
          }
          return state.customerType === 'privat'
            ? '<div class="cleaner-price">' + rutRate + ' kr/h</div><div class="cleaner-rut">inkl. RUT-avdrag</div>'
            : '<div class="cleaner-price">' + rate + ' kr/h</div>';`;

if (b.includes(oldPriceDisplay)) {
  b = b.replace(oldPriceDisplay, newPriceDisplay);
  fixes++;
  console.log('FIX 1 OK - per-kvm price display in cleaner cards');
} else {
  console.log('FIX 1 SKIP - pattern not found');
}


// ─── FIX 2: Företagsnamn istf personnamn ───
// Company cleaners → show company name as primary
// Solo cleaners → show full_name
const oldNameDisplay = '${cl.full_name||\'Städare\'}${cl.company_name ? ` <span style="font-size:.75rem;color:#6B7280;font-weight:400">· ${escHtml(cl.company_name)}</span>` : \'\'}';
const newNameDisplay = '${cl.company_name ? escHtml(cl.company_name) : (cl.full_name||\'Städare\')}';

if (b.includes(oldNameDisplay)) {
  b = b.replace(oldNameDisplay, newNameDisplay);
  fixes++;
  console.log('FIX 2a OK - company name as primary in card title');
} else {
  console.log('FIX 2a SKIP');
}

// Also fix the "Välj X →" button to use company name or first name
const oldChooseBtn = "expandHTML += '<button class=\"cleaner-choose-btn\">Välj ' + escHtml((cl.full_name || '').split(' ')[0]) + ' →</button>';";
const newChooseBtn = "expandHTML += '<button class=\"cleaner-choose-btn\">Välj ' + escHtml(cl.company_name ? cl.company_name.split(' ')[0] : (cl.full_name || '').split(' ')[0]) + ' →</button>';";

if (b.includes(oldChooseBtn)) {
  b = b.replace(oldChooseBtn, newChooseBtn);
  fixes++;
  console.log('FIX 2b OK - choose button uses company name');
} else {
  console.log('FIX 2b SKIP');
}


// ─── FIX 3: Ta bort missvisande prisuppskattning i steg 1 ───
// Replace hardcoded 450 kr estimate with hidden element
const oldEstimate = `    const estRate = 450;
    const est = Math.round(state.hours * estRate);
    const rutEst = Math.round(est * 0.5);
    document.getElementById('price-gross').textContent = est.toLocaleString('sv-SE');
    document.getElementById('price-after-rut').textContent = rutEst.toLocaleString('sv-SE');
    var rutLine = document.getElementById('price-rut-line');
    if (rutLine) rutLine.style.display = state.customerType === 'privat' ? '' : 'none';
    peEl.style.display = 'block';`;
const newEstimate = `    // Prisuppskattning borttagen — visas i steg 2 med faktiska priser
    peEl.style.display = 'none';`;

if (b.includes(oldEstimate)) {
  b = b.replace(oldEstimate, newEstimate);
  fixes++;
  console.log('FIX 3 OK - removed misleading price estimate from step 1');
} else {
  console.log('FIX 3 SKIP');
}


// ─── FIX 4: RUT Math.floor (remaining Math.round * 0.5) ───
const rutBefore = (b.match(/Math\.round\([^)]*\* 0\.5\)/g) || []).length;
b = b.replace(/Math\.round\(([^)]*?)\*\s*0\.5\)/g, 'Math.floor($1* 0.5)');
const rutAfter = (b.match(/Math\.round\([^)]*\* 0\.5\)/g) || []).length;
if (rutBefore > rutAfter) {
  fixes++;
  console.log('FIX 4 OK - RUT Math.floor (' + (rutBefore - rutAfter) + ' replacements)');
} else {
  console.log('FIX 4 SKIP - already done');
}


fs.writeFileSync('boka.html', b);


// ═══════════════════════════════════════════════════
// Edge Functions — RUT Math.floor
// ═══════════════════════════════════════════════════
const efFiles = [
  'supabase/functions/booking-create/index.ts',
  'supabase/functions/rut-claim/index.ts',
  'supabase/functions/stripe-checkout/index.ts',
  'supabase/functions/cleaner-og/index.ts'
];

efFiles.forEach(function(f) {
  try {
    let c = fs.readFileSync(f, 'utf8');
    const count = (c.match(/Math\.round\([^)]*\*\s*0\.5\)/g) || []).length;
    if (count > 0) {
      c = c.replace(/Math\.round\(([^)]*?)\*\s*0\.5\)/g, 'Math.floor($1* 0.5)');
      // Handle nested parens case
      c = c.replace(/Math\.round\(\(([^)]*)\)\s*\*\s*0\.5\)/g, 'Math.floor(($1) * 0.5)');
      fs.writeFileSync(f, c);
      fixes++;
      console.log('FIX 5 OK - ' + f + ' (' + count + ')');
    } else {
      // Try nested parens pattern
      const count2 = (c.match(/Math\.round\(\([^)]*\)\s*\*\s*0\.5\)/g) || []).length;
      if (count2 > 0) {
        c = c.replace(/Math\.round\(\(([^)]*)\)\s*\*\s*0\.5\)/g, 'Math.floor(($1) * 0.5)');
        fs.writeFileSync(f, c);
        fixes++;
        console.log('FIX 5 OK - ' + f + ' (nested, ' + count2 + ')');
      } else {
        console.log('FIX 5 SKIP - ' + f + ' (already done)');
      }
    }
  } catch(e) {
    console.log('FIX 5 SKIP - ' + f + ' (not found)');
  }
});


console.log('\nDone - ' + fixes + ' fixes total');
