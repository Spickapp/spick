const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const W = 1200, H = 630;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// Background
ctx.fillStyle = '#1a7d56';
ctx.fillRect(0, 0, W, H);

// "Spick" — large centered
ctx.fillStyle = '#ffffff';
ctx.textAlign = 'center';
ctx.font = 'bold 96px sans-serif';
ctx.fillText('Spick', W / 2, 220);

// Tagline
ctx.font = '36px sans-serif';
ctx.fillText('Boka en städare du verkligen litar på', W / 2, 290);

// Divider line
ctx.strokeStyle = 'rgba(255,255,255,0.3)';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(200, 420);
ctx.lineTo(1000, 420);
ctx.stroke();

// Three columns
const cols = [
  '50% billigare med RUT',
  'ID-verifierade städare',
  'Boka på 2 min'
];
ctx.font = '28px sans-serif';
const colW = W / 3;
cols.forEach((text, i) => {
  ctx.fillText(text, colW * i + colW / 2, 480);
});

// Save
const out = path.join(__dirname, '..', 'assets', 'og-image.png');
fs.writeFileSync(out, canvas.toBuffer('image/png'));
console.log('OG image saved to', out);
