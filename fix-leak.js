const fs = require("fs");
const fp = "C:\\Users\\farha\\spick\\boka.html";
let c = fs.readFileSync(fp, "utf8");

// Find the leaked text at the start of the file
// It starts with BOM + newline + service details
const leakStart = 0;
const leakContent = "'Trappst\u00e4dning':";

if (c.indexOf(leakContent) < 500) {
  // The leaked content is near the start - find where it ends
  // It ends before <!DOCTYPE or <html
  const doctype = c.indexOf('<!DOCTYPE');
  if (doctype > 0) {
    const leaked = c.substring(0, doctype).trim();
    console.log("Leaked content length:", leaked.length);
    console.log("First 80 chars:", leaked.substring(0, 80));
    
    // Remove the leaked content from beginning
    c = c.substring(doctype);
    console.log("1. Removed leaked content from start - OK");
    
    // Now check if the serviceDetails already has the entries inside the script
    // Find the Kontorsstädning entry in serviceDetails
    const kontorDetail = "'Kontorsst\u00e4dning': {";
    const kontorIdx = c.indexOf(kontorDetail);
    
    if (kontorIdx > -1) {
      // Find the closing of Kontorsstädning block
      const kontorClose = c.indexOf("},", kontorIdx);
      if (kontorClose > -1) {
        // Check if Trappstädning already exists after it (inside script)
        const nextChunk = c.substring(kontorClose, kontorClose + 200);
        if (!nextChunk.includes("'Trappst\u00e4dning'")) {
          // Need to insert the new service details
          const newDetails = `},
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
          c = c.substring(0, kontorClose) + newDetails + c.substring(kontorClose + 1);
          console.log("2. Service details inserted at correct position - OK");
        } else {
          console.log("2. Service details already in correct position - OK");
        }
      }
    }
  }
} else {
  console.log("No leaked content found at start of file");
  
  // Still check if details are in the right place
  const hasTrapp = c.indexOf("'Trappst\u00e4dning':") > 1000;
  console.log("Trappstädning in correct location:", hasTrapp);
}

fs.writeFileSync(fp, c, "utf8");

// Verify
const final = fs.readFileSync(fp, "utf8");
console.log("\n--- VERIFY ---");
console.log("Starts with <!DOCTYPE:", final.trimStart().startsWith("<!DOCTYPE"));
console.log("No leak at start:", final.indexOf("'Trappst\u00e4dning':") > 1000);
console.log("Has all B2B details:", 
  final.includes("'Trappst\u00e4dning':") && 
  final.includes("'Skolst\u00e4dning':") && 
  final.includes("'V\u00e5rdst\u00e4dning':") &&
  final.includes("'Hotell & restaurang':"));
console.log("SUCCESS");
