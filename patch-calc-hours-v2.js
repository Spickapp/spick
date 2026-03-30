const fs = require('fs');
let f = fs.readFileSync('boka.html', 'utf8');
const old = "if (state.service === 'Storst\u00e4dning' || state.service === 'Flyttst\u00e4dning') h = Math.ceil(h * 1.5);";
const nw = "if (state.service === 'Storst\u00e4dning') h = Math.ceil(h * 1.7 * 2) / 2;\r\n  else if (state.service === 'Flyttst\u00e4dning') h = Math.ceil(h * 2.2 * 2) / 2;\r\n  else if (state.service === 'F\u00f6nsterputs') h = Math.max(1, Math.ceil(sqm / 40 * 2) / 2);";
console.log('Found:', f.includes(old));
f = f.replace(old, nw);
fs.writeFileSync('boka.html', f, 'utf8');
console.log('Done');
