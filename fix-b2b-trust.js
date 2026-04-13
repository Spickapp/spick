const fs = require("fs");
const fp = "C:\\Users\\farha\\spick\\foretag.html";
let c = fs.readFileSync(fp, "utf8");
let fixes = 0;

// ═══ BADGES ═══
const oldBadges = "h += '<span class=\"hero-badge\">\u2713 F-skattsedel</span>';\n    h += '<span class=\"hero-badge\">\u2713 RUT-avdrag</span>';";
if (c.includes(oldBadges)) {
  c = c.replace(oldBadges, `if (isB2B) {
      h += '<span class="hero-badge">\u2713 F-skattsedel</span>';
      h += '<span class="hero-badge">\u2713 Avtalskunder</span>';
    } else {
      h += '<span class="hero-badge">\u2713 F-skattsedel</span>';
      h += '<span class="hero-badge">\u2713 RUT-avdrag</span>';
    }`);
  fixes++;
  console.log("Badges - OK");
} else {
  console.log("Badges - SKIP, pattern not found");
}

// ═══ TRUST ═══
const oldTrust = "h += '<div class=\"trust-item\"><div class=\"trust-check\">\u2713</div><div class=\"trust-label\">ID-verifierade<br>st\u00e4dare</div></div>';";
if (c.includes(oldTrust)) {
  // Find the entire trust block (6 items + closing div)
  const trustStart = c.indexOf(oldTrust);
  const trustGridOpen = c.lastIndexOf("h += '<div class=\"trust-grid\">';", trustStart);
  const trustEnd = c.indexOf("'</div></div>';", trustStart + 100);
  // Find the 6th trust item's closing
  let lastTrustClose = trustStart;
  for (let i = 0; i < 6; i++) {
    lastTrustClose = c.indexOf("trust-item", lastTrustClose + 1);
  }
  // Find the end after the last trust item
  const blockEnd = c.indexOf("</div></div>';", lastTrustClose) + "</div></div>';".length;
  
  const oldBlock = c.substring(trustGridOpen, blockEnd);
  
  const newBlock = `h += '<div class="trust-grid">';
    if (isB2B) {
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">Utbildad<br>personal</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">Godk\u00e4nd f\u00f6r<br>F-skatt</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">Kvalitets-<br>kontroll</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">Fast kontakt-<br>person</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">Anpassade<br>l\u00f6sningar</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">L\u00e5ngsiktiga<br>samarbeten</div></div>';
    } else {
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">ID-verifierade<br>st\u00e4dare</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">Godk\u00e4nd f\u00f6r<br>F-skatt</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">RUT-avdrag<br>direkt</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">S\u00e4ker kort-<br>betalning</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">N\u00f6jd-kund-<br>garanti</div></div>';
      h += '<div class="trust-item"><div class="trust-check">\u2713</div><div class="trust-label">Klarna<br>tillg\u00e4ngligt</div></div>';
    }
    h += '</div></div>';`;
  
  c = c.substring(0, trustGridOpen) + newBlock + c.substring(blockEnd);
  fixes++;
  console.log("Trust - OK");
} else {
  console.log("Trust - SKIP");
}

// ═══ BOTTOM CTA ═══
const oldCta = "Professionell st\u00e4dning med s\u00e4ker betalning och RUT-avdrag";
if (c.includes(oldCta)) {
  c = c.replace(oldCta, "' + (isB2B ? 'Professionell st\u00e4dservice f\u00f6r f\u00f6retag och organisationer' : 'Professionell st\u00e4dning med s\u00e4ker betalning och RUT-avdrag') + '");
  fixes++;
  console.log("Bottom CTA - OK");
}

fs.writeFileSync(fp, c, "utf8");

const final = fs.readFileSync(fp, "utf8");
console.log("\nB2B badges:", final.includes("Avtalskunder"));
console.log("B2B trust:", final.includes("Kvalitets"));
console.log("B2B CTA:", final.includes("f\u00f6retag och organisationer"));
console.log("Fixes:", fixes);
console.log(fixes >= 2 ? "SUCCESS" : "PARTIAL");
