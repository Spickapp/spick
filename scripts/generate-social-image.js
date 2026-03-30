#!/usr/bin/env node
// generate-social-image.js
// Generates a branded 1080x1080 social media image for Spick
// Uses SVG template + sharp (no system dependencies needed)
//
// Usage: node generate-social-image.js --hook "Text here" --pillar "trust" --day 1
// Output: social-image.png in current directory

const sharp = require('sharp');
const path = require('path');

const PILLAR_THEMES = {
  trust: {
    bg1: '#0A4E3D',
    bg2: '#0F6E56',
    accent: '#1D9E75',
    icon: '\u2713',
    label: 'F\u00f6rtroende'
  },
  tips: {
    bg1: '#0C447C',
    bg2: '#185FA5',
    accent: '#378ADD',
    icon: '\u2728',
    label: 'St\u00e4dtips'
  },
  rut: {
    bg1: '#3C3489',
    bg2: '#534AB7',
    accent: '#7F77DD',
    icon: '%',
    label: 'RUT-avdrag'
  },
  transformation: {
    bg1: '#712B13',
    bg2: '#993C1D',
    accent: '#D85A30',
    icon: '\u2192',
    label: 'F\u00f6re & efter'
  },
  bts: {
    bg1: '#72243E',
    bg2: '#993556',
    accent: '#D4537E',
    icon: '\u266b',
    label: 'Bakom kulisserna'
  }
};

function wrapText(text, maxCharsPerLine) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length > maxCharsPerLine) {
      if (currentLine) lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine = currentLine ? currentLine + ' ' + word : word;
    }
  }
  if (currentLine) lines.push(currentLine.trim());
  return lines;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateSVG(hook, pillar, day) {
  const theme = PILLAR_THEMES[pillar] || PILLAR_THEMES.trust;
  const lines = wrapText(hook, 22);
  const fontSize = lines.some(l => l.length > 18) ? 64 : 72;
  const lineHeight = fontSize * 1.25;
  const totalTextHeight = lines.length * lineHeight;
  const textStartY = (1080 - totalTextHeight) / 2 + fontSize * 0.35;

  const textLines = lines.map((line, i) =>
    `<text x="540" y="${textStartY + i * lineHeight}" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="white" letter-spacing="-1">${escapeXml(line)}</text>`
  ).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.bg1}"/>
      <stop offset="100%" stop-color="${theme.bg2}"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="white" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1080" height="1080" fill="url(#bg)"/>

  <!-- Subtle geometric decoration -->
  <circle cx="900" cy="180" r="220" fill="white" opacity="0.04"/>
  <circle cx="180" cy="900" r="160" fill="white" opacity="0.03"/>
  <rect x="0" y="0" width="1080" height="1080" fill="url(#shine)"/>

  <!-- Top bar with pillar label -->
  <rect x="60" y="60" width="960" height="3" rx="1.5" fill="${theme.accent}" opacity="0.6"/>

  <!-- Pillar badge -->
  <rect x="60" y="85" width="${theme.label.length * 16 + 40}" height="40" rx="20" fill="white" opacity="0.12"/>
  <text x="80" y="112" font-family="'Helvetica Neue', Arial, sans-serif" font-size="18" font-weight="500" fill="white" opacity="0.8">${escapeXml(theme.label)}</text>

  <!-- Main hook text -->
  <g>
    ${textLines}
  </g>

  <!-- Bottom section -->
  <rect x="60" y="940" width="960" height="3" rx="1.5" fill="${theme.accent}" opacity="0.6"/>

  <!-- Spick branding -->
  <text x="60" y="1000" font-family="'Playfair Display', Georgia, serif" font-size="36" font-weight="700" fill="white" letter-spacing="2">SPICK</text>

  <!-- CTA -->
  <text x="1020" y="1000" text-anchor="end" font-family="'Helvetica Neue', Arial, sans-serif" font-size="20" font-weight="400" fill="white" opacity="0.7">spick.se/boka</text>

  <!-- Day indicator -->
  <text x="1020" y="112" text-anchor="end" font-family="'Helvetica Neue', Arial, sans-serif" font-size="14" font-weight="400" fill="white" opacity="0.4">Dag ${day}</text>
</svg>`;
}

async function main() {
  const args = process.argv.slice(2);
  let hook = 'Hemst\u00e4dning fr\u00e5n 175 kr/h';
  let pillar = 'trust';
  let day = 1;
  let output = 'social-image.png';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--hook' && args[i + 1]) hook = args[++i];
    if (args[i] === '--pillar' && args[i + 1]) pillar = args[++i].toLowerCase();
    if (args[i] === '--day' && args[i + 1]) day = parseInt(args[++i]);
    if (args[i] === '--output' && args[i + 1]) output = args[++i];
  }

  console.log(`Generating image: pillar=${pillar}, day=${day}`);
  console.log(`Hook: "${hook}"`);

  const svg = generateSVG(hook, pillar, day);
  const svgBuffer = Buffer.from(svg);

  await sharp(svgBuffer)
    .resize(1080, 1080)
    .png({ quality: 90 })
    .toFile(output);

  console.log(`Image saved: ${output}`);
  return output;
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
