const fs = require("fs");
const filepath = "C:\\Users\\farha\\spick\\boka.html";
let c = fs.readFileSync(filepath, "utf8");

// Find the existing company fetch callback and add h1/title update
const anchor = "console.log('[SPICK] Company allow_customer_choice:', window.companyAllowChoice);";
if (!c.includes(anchor)) {
  console.error("ERROR: Could not find company fetch callback");
  process.exit(1);
}

const replacement = `console.log('[SPICK] Company allow_customer_choice:', window.companyAllowChoice);
          // Update heading and title for company bookings
          var compName = rows[0].display_name || rows[0].name || '';
          if (compName) {
            var h1 = document.getElementById('page-h1');
            if (h1) h1.textContent = 'Boka via ' + compName;
            document.title = 'Boka städning via ' + compName + ' | Spick';
          }`;

c = c.replace(anchor, replacement);

fs.writeFileSync(filepath, c, "utf8");

// Verify
const final = fs.readFileSync(filepath, "utf8");
console.log("H1 update added:", final.includes("Boka via"));
console.log("Title update added:", final.includes("Boka städning via"));
console.log("SUCCESS");
