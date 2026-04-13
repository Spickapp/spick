const fs = require("fs");
const fp = "C:\\Users\\farha\\spick\\foretag.html";
let c = fs.readFileSync(fp, "utf8");

// Find the double </div></div> after trust section
const trustClose = "h += '</div></div>';";
const recensioner = "// \u2500\u2500 RECENSIONER";

// Find trust close followed by another </div></div> followed by recensioner
const recIdx = c.indexOf(recensioner);
if (recIdx === -1) { console.log("FAIL: recensioner not found"); process.exit(1); }

// Look backward from recensioner for the double close
const before = c.substring(recIdx - 200, recIdx);
console.log("Before recensioner:", JSON.stringify(before.slice(-100)));

// Count </div></div> occurrences right before recensioner
const lines = before.split('\n');
let divCloseCount = 0;
let lastDivIdx = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].trim().includes("</div></div>'")) {
    divCloseCount++;
    if (divCloseCount === 1) lastDivIdx = i;
  } else if (lines[i].trim().length > 0) {
    break;
  }
}
console.log("Consecutive </div></div> closes:", divCloseCount);

if (divCloseCount >= 2) {
  // Remove one of them
  const doubleClose = "h += '</div></div>';\r\n    h += '</div></div>';";
  const singleClose = "h += '</div></div>';";
  
  if (c.includes(doubleClose)) {
    // Only replace the one right before recensioner
    const doubleIdx = c.lastIndexOf(doubleClose, recIdx);
    if (doubleIdx > -1) {
      c = c.substring(0, doubleIdx) + singleClose + c.substring(doubleIdx + doubleClose.length);
      console.log("FIXED - removed extra </div></div>");
    }
  } else {
    console.log("Double close not found with CRLF, trying LF");
    const doubleCloseLF = "h += '</div></div>';\n    h += '</div></div>';";
    const doubleLFIdx = c.lastIndexOf(doubleCloseLF, recIdx);
    if (doubleLFIdx > -1) {
      c = c.substring(0, doubleLFIdx) + singleClose + c.substring(doubleLFIdx + doubleCloseLF.length);
      console.log("FIXED (LF)");
    } else {
      console.log("FAIL - could not find double close");
    }
  }
} else {
  console.log("Only", divCloseCount, "closes found - may already be fixed");
}

fs.writeFileSync(fp, c, "utf8");
