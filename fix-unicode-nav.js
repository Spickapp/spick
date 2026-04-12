const fs = require('fs');
const f = 'stadare-dashboard.html';
let c = fs.readFileSync(f, 'utf8');
let fixes = 0;

// 1. Fix unicode in banner text (replace escaped unicode with actual characters)
const oldBanner = '\\u2705 Spick hanterar bokning, betalning, RUT och kundkommunikation \\u2014 <strong>du fokuserar p\\u00e5 st\\u00e4dningen</strong>';
const newBanner = '\u2705 Spick hanterar bokning, betalning, RUT och kundkommunikation \u2014 <strong>du fokuserar p\u00e5 st\u00e4dningen</strong>';

if (c.includes(oldBanner)) {
  c = c.replace(oldBanner, newBanner);
  fixes++;
  console.log('FIX 1 OK - unicode in banner');
}

// 2. Also fix unicode in review "Inga recensioner"
const oldReview = 'Inga recensioner \\u00e4nnu.';
if (c.includes(oldReview)) {
  c = c.replace(oldReview, 'Inga recensioner \u00e4nnu.');
  fixes++;
  console.log('FIX 2 OK - unicode in reviews');
}

// 3. Fix unicode in booking "Inga bokningar"
const oldBooking = 'Inga bokningar \\u00e4nnu.';
if (c.includes(oldBooking)) {
  c = c.replace(oldBooking, 'Inga bokningar \u00e4nnu.');
  fixes++;
  console.log('FIX 3 OK - unicode in bookings');
}

fs.writeFileSync(f, c);
console.log('Done - ' + fixes + ' fixes');
