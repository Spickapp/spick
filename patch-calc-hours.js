/**
 * patch-calc-hours.js
 * 
 * Förbättrar tidsberäkningen i calcHours() så att varje tjänst
 * får en realistisk multiplikator istället för samma 2x för alla.
 * 
 * Hemstädning:   bastabell (oförändrad)
 * Storstädning:  × 1.7
 * Flyttstädning: × 2.2
 * Fönsterputs:   egen formel (1h per ~10 fönster, baserat på kvm)
 * 
 * Kör: node patch-calc-hours.js
 */
const fs = require('fs');
let f = fs.readFileSync('boka.html', 'utf8');
const orig = f;

// Hitta och ersätt den gamla multiplier-logiken
const oldLogic = "// Storstädning tar ca 2x så långt\n  if (state.service === 'Storstädning') h = h * 2;\n  if (state.service === 'Flyttstädning') h = h * 2;";

const newLogic = `// Tjänstespecifika multiplikatorer
  if (state.service === 'Storstädning') h = Math.ceil(h * 1.7 * 2) / 2;
  else if (state.service === 'Flyttstädning') h = Math.ceil(h * 2.2 * 2) / 2;
  else if (state.service === 'Fönsterputs') {
    // Ca 1h per 40 kvm, minimum 1h
    h = Math.max(1, Math.ceil(sqm / 40 * 2) / 2);
  }`;

if (f.includes(oldLogic)) {
  f = f.replace(oldLogic, newLogic);
  console.log('\x1b[32m\u2705 calcHours uppdaterad med tjänstespecifika multiplikatorer\x1b[0m');
} else {
  // Try alternate whitespace
  const alt = f.match(/\/\/ Storst[^]*?service === 'Flyttst[^]*?h \* 2;/);
  if (alt) {
    f = f.replace(alt[0], newLogic);
    console.log('\x1b[32m\u2705 calcHours uppdaterad (alternativ matchning)\x1b[0m');
  } else {
    console.log('\x1b[31m\u274c Kunde inte hitta gammal calcHours-logik\x1b[0m');
    console.log('Sök manuellt efter: "Storstädning tar ca 2x"');
  }
}

// Spara
if (f !== orig) {
  fs.writeFileSync('boka.html', f, 'utf8');

  // Verifiera resultatet
  console.log('\nVerifiering (60 kvm):');
  const sqm = 60;
  let h = 2.5; // bastabell för 60 kvm
  console.log('  Hemstädning:   ' + h + 'h');
  console.log('  Storstädning:  ' + (Math.ceil(h * 1.7 * 2) / 2) + 'h');
  console.log('  Flyttstädning: ' + (Math.ceil(h * 2.2 * 2) / 2) + 'h');
  console.log('  Fönsterputs:   ' + Math.max(1, Math.ceil(sqm / 40 * 2) / 2) + 'h');

  console.log('\nVerifiering (100 kvm):');
  h = 3.5;
  console.log('  Hemstädning:   ' + h + 'h');
  console.log('  Storstädning:  ' + (Math.ceil(h * 1.7 * 2) / 2) + 'h');
  console.log('  Flyttstädning: ' + (Math.ceil(h * 2.2 * 2) / 2) + 'h');
  console.log('  Fönsterputs:   ' + Math.max(1, Math.ceil(100 / 40 * 2) / 2) + 'h');

  console.log('\n\x1b[32m\ud83c\udf89 Patch klar!\x1b[0m');
} else {
  console.log('Ingen ändring gjord.');
}
