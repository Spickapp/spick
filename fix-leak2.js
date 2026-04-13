const fs = require("fs");
const fp = "C:\\Users\\farha\\spick\\boka.html";
let c = fs.readFileSync(fp, "utf8");

// Find Kontorsstädning in serviceDetails
const anchor = "'Kontorsst\u00e4dning': {";
const idx = c.indexOf(anchor);
if (idx === -1) { console.log("FAIL: anchor not found"); process.exit(1); }

// Find the note line which ends the Kontorsstädning block
const noteStart = c.indexOf("note:", idx);
const noteEnd = c.indexOf("}", noteStart);
// Find the next closing that ends the entry
// Pattern: note: '...' \n  }
// We need to find '}' after the note, then check what follows

// Safer: find "};", the closing of the whole serviceDetails object
// Or find the next '}' after the note line
const closeBrace = c.indexOf("}", noteStart + 5);
if (closeBrace === -1) { console.log("FAIL: close brace not found"); process.exit(1); }

// Check what character follows the }
const afterBrace = c.substring(closeBrace, closeBrace + 20);
console.log("After close brace:", JSON.stringify(afterBrace));

// Check if Trappstädning already exists
if (c.includes("'Trappst\u00e4dning': {")) {
  console.log("Trappstädning already exists - SKIP");
  process.exit(0);
}

// Insert after the } that closes Kontorsstädning
const newDetails = `,
  'Trappst\u00e4dning': {
    items: ['Entr\u00e9 sopat och moppat','Trappor dammsugt och moppat','R\u00e4cken och ledst\u00e4nger avtorkade','D\u00f6rrar och d\u00f6rrhandtag rengjorda','F\u00f6nster i trapphus','Brevl\u00e5deomr\u00e5de rengjort'],
    note: 'Anpassas efter fastighetens storlek och antal v\u00e5ningar.'
  },
  'Skolst\u00e4dning': {
    items: ['Klassrum \u2014 golv, b\u00e4nkar, stolar','Korridorer dammsugt och moppat','Toaletter rengjorda och p\u00e5fyllda','Matsal/k\u00f6k rengjort','Kontaktytor desinficerade','Papperskorgar t\u00f6mda'],
    note: 'Anpassad efter skolans schema och verksamhet.'
  },
  'V\u00e5rdst\u00e4dning': {
    items: ['Patientrum rengjort och desinficerat','Hygienutrymmen grundligt rengjorda','Kontaktytor desinficerade','Golv moppat med desinfektionsmedel','V\u00e4ntrum rengjort','Avfall hanterat enligt rutiner'],
    note: 'Utf\u00f6rs enligt strikta hygienrutiner f\u00f6r v\u00e5rdmilj\u00f6er.'
  },
  'Hotell & restaurang': {
    items: ['Lobby och reception rengjord','Matsal/restaurangyta rengjord','K\u00f6ksn\u00e4ra ytor rengjorda','G\u00e4sttoaletter rengjorda och p\u00e5fyllda','Golv dammsugt och moppat','Glaspartier och entr\u00e9 putsade'],
    note: 'Anpassas efter verksamhetens \u00f6ppettider och g\u00e4stfl\u00f6de.'
  }`;

c = c.substring(0, closeBrace + 1) + newDetails + c.substring(closeBrace + 1);

fs.writeFileSync(fp, c, "utf8");

const final = fs.readFileSync(fp, "utf8");
console.log("Starts with <!DOCTYPE:", final.trimStart().startsWith("<!DOCTYPE"));
console.log("Has Trappstädning:", final.includes("'Trappst\u00e4dning': {"));
console.log("Has Skolstädning:", final.includes("'Skolst\u00e4dning': {"));
console.log("Has Vårdstädning:", final.includes("'V\u00e5rdst\u00e4dning': {"));
console.log("Has Hotell:", final.includes("'Hotell & restaurang': {"));
console.log("No leak at start:", final.indexOf("'Trappst\u00e4dning':") > 1000);
console.log("SUCCESS");
