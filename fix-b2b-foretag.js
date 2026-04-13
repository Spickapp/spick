const fs = require("fs");
const fp = "C:\\Users\\farha\\spick\\foretag.html";
let c = fs.readFileSync(fp, "utf8");
let fixes = 0;

// ═══ 1. DETECT B2B — lägg till variabel efter members fetch ═══
// B2B = om VD:n har B2B-tjänster (Kontorsstädning, Trappstädning, etc) och INTE Hemstädning
const afterMembers = "var active = members.filter(function(m) { return !m.owner_only && m.status !== 'pausad'; });";
if (c.includes(afterMembers)) {
  c = c.replace(afterMembers, afterMembers + `

    // Detect B2B company
    var allSvcs = [];
    members.forEach(function(m) { if (Array.isArray(m.services)) m.services.forEach(function(s) { if (allSvcs.indexOf(s) === -1) allSvcs.push(s); }); });
    var b2bSvcs = ['Kontorsst\\u00e4dning','Trappst\\u00e4dning','Skolst\\u00e4dning','V\\u00e5rdst\\u00e4dning','Hotell & restaurang'];
    var isB2B = allSvcs.some(function(s) { return b2bSvcs.indexOf(s) > -1; }) && allSvcs.indexOf('Hemst\\u00e4dning') === -1;`);
  fixes++;
  console.log("1. B2B detection added - OK");
}

// ═══ 2. HIDE 0-STATS ═══
// Hide "0 utförda jobb" and "0 städare" when values are 0
const statsJobb = "h += '<div><div class=\"hero-stat-val animated-counter\" data-target=\"' + totalJobs + '\">0</div><div class=\"hero-stat-lbl\">Utf\\u00f6rda jobb</div></div>';";
if (c.includes(statsJobb)) {
  c = c.replace(statsJobb, "if (totalJobs > 0) h += '<div><div class=\"hero-stat-val animated-counter\" data-target=\"' + totalJobs + '\">0</div><div class=\"hero-stat-lbl\">Utf\\u00f6rda jobb</div></div>';");
  fixes++;
  console.log("2a. Hide 0 jobs - OK");
}

const statsStadare = "h += '<div><div class=\"hero-stat-val animated-counter\" data-target=\"' + active.length + '\">0</div><div class=\"hero-stat-lbl\">St\\u00e4dare</div></div>';";
if (c.includes(statsStadare)) {
  c = c.replace(statsStadare, "if (active.length > 0) h += '<div><div class=\"hero-stat-val animated-counter\" data-target=\"' + active.length + '\">0</div><div class=\"hero-stat-lbl\">St\\u00e4dare</div></div>';");
  fixes++;
  console.log("2b. Hide 0 cleaners - OK");
}

// ═══ 3. B2B BADGES — byt RUT mot B2B badges ═══
const oldBadges = "h += '<span class=\"hero-badge\">\\u2713 F-skattsedel</span>';\n    h += '<span class=\"hero-badge\">\\u2713 RUT-avdrag</span>';";
if (c.includes(oldBadges)) {
  const newBadges = `if (isB2B) {
      h += '<span class="hero-badge">\\u2713 F-skattsedel</span>';
      h += '<span class="hero-badge">\\u2713 Avtalskunder</span>';
    } else {
      h += '<span class="hero-badge">\\u2713 F-skattsedel</span>';
      h += '<span class="hero-badge">\\u2713 RUT-avdrag</span>';
    }`;
  c = c.replace(oldBadges, newBadges);
  fixes++;
  console.log("3. B2B badges - OK");
}

// ═══ 4. B2B TRUST SIGNALS ═══
const oldTrust = "h += '<div class=\"trust-grid\">';\n    h += '<div class=\"trust-item\"><div class=\"trust-check\">\\u2713</div><div class=\"trust-label\">ID-verifierade<br>st\\u00e4dare</div></div>';";
if (c.includes(oldTrust)) {
  const newTrust = `h += '<div class="trust-grid">';
    if (isB2B) {
      h += '<div class="trust-item"><div class="trust-check">\\u2713</div><div class="trust-label">Utbildad<br>personal</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\\u2713</div><div class="trust-label">Godk\\u00e4nd f\\u00f6r<br>F-skatt</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\\u2713</div><div class="trust-label">Kvalitets-<br>kontroll</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\\u2713</div><div class="trust-label">Fast kontakt-<br>person</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\\u2713</div><div class="trust-label">Anpassade<br>l\\u00f6sningar</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\\u2713</div><div class="trust-label">L\\u00e5ngsiktiga<br>samarbeten</div></div>';
    } else {
      h += '<div class="trust-item"><div class="trust-check">\\u2713</div><div class="trust-label">ID-verifierade<br>st\\u00e4dare</div></div>';`;
  c = c.replace(oldTrust, newTrust);
  fixes++;
  console.log("4. B2B trust signals - OK");
} else {
  console.log("4. SKIP - trust anchor not found");
}

// ═══ 5. B2B FAQ ═══
const oldFaq = "var faqs = [";
if (c.includes(oldFaq)) {
  const newFaq = `var b2bFaqs = [
      { q: 'Vilka tj\\u00e4nster erbjuder ni?', a: 'Vi erbjuder kontorsst\\u00e4dning, trappst\\u00e4dning, skol- och f\\u00f6rskolest\\u00e4dning, v\\u00e5rdlokalst\\u00e4dning och hotell- och restaurangst\\u00e4dning.' },
      { q: 'Hur fungerar ert kvalitetsarbete?', a: 'Vi arbetar med tydliga rutiner, utbildad personal och regelbunden kvalitetskontroll. Ni f\\u00e5r en fast kontaktperson som ansvarar f\\u00f6r uppf\\u00f6ljning.' },
      { q: 'Kan ni anpassa st\\u00e4dningen efter v\\u00e5ra behov?', a: 'Ja! Vi skr\\u00e4ddarsyr uppdraget efter era lokaler, arbetstider och \\u00f6nskem\\u00e5l.' },
      { q: 'Vad kostar det?', a: 'Priset baseras p\\u00e5 lokalens storlek och frekvens. Kontakta oss f\\u00f6r en kostnadsfri offert.' },
      { q: 'Hur snabbt kan ni b\\u00f6rja?', a: 'Vi kan oftast starta inom en vecka efter \\u00f6verenskommelse.' },
      { q: 'Har ni ansvarsf\\u00f6rs\\u00e4kring?', a: 'Ja, alla v\\u00e5ra uppdrag \\u00e4r f\\u00f6rs\\u00e4krade. Vi tar fullt ansvar f\\u00f6r utf\\u00f6rt arbete.' }
    ];
    var privatFaqs = [`;
  c = c.replace(oldFaq, newFaq);
  
  // Close privatFaqs and add selection logic
  const faqForEach = "faqs.forEach(function(f) {";
  if (c.includes(faqForEach)) {
    c = c.replace(faqForEach, "var faqs = isB2B ? b2bFaqs : privatFaqs;\n    faqs.forEach(function(f) {");
    fixes++;
    console.log("5. B2B FAQ - OK");
  }
}

// ═══ 6. B2B BOTTOM CTA ═══
const oldBottomCta = "Professionell st\\u00e4dning med s\\u00e4ker betalning och RUT-avdrag";
if (c.includes(oldBottomCta)) {
  c = c.replace(oldBottomCta, "' + (isB2B ? 'Professionell st\\u00e4dservice f\\u00f6r f\\u00f6retag och organisationer' : 'Professionell st\\u00e4dning med s\\u00e4ker betalning och RUT-avdrag') + '");
  fixes++;
  console.log("6. B2B bottom CTA - OK");
}

fs.writeFileSync(fp, c, "utf8");

const final = fs.readFileSync(fp, "utf8");
console.log("\n--- VERIFY ---");
console.log("isB2B detection:", final.includes("var isB2B"));
console.log("Hide 0 stats:", final.includes("if (totalJobs > 0)"));
console.log("B2B badges:", final.includes("Avtalskunder"));
console.log("B2B trust:", final.includes("Kvalitets"));
console.log("B2B FAQ:", final.includes("b2bFaqs"));
console.log("Fixes:", fixes);
console.log(fixes >= 5 ? "SUCCESS" : "PARTIAL");
