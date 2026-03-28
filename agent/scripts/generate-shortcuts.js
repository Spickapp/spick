#!/usr/bin/env node
// scripts/generate-shortcuts.js – Generate iOS Shortcut URLs and QR codes
//
// Usage:
//   node scripts/generate-shortcuts.js http://192.168.1.100:3500 YOUR_SECRET
//   node scripts/generate-shortcuts.js https://xxx.trycloudflare.com YOUR_SECRET
//
// Creates an HTML file with clickable links that open iOS Shortcuts.

const fs = require("fs");
const path = require("path");

const BASE_URL = process.argv[2];
const TOKEN = process.argv[3];

if (!BASE_URL || !TOKEN) {
  console.log(`
Usage: node scripts/generate-shortcuts.js <BASE_URL> <API_SECRET>

Example:
  node scripts/generate-shortcuts.js http://192.168.1.100:3500 my_secret_key
  node scripts/generate-shortcuts.js https://abc.trycloudflare.com my_secret_key
  `);
  process.exit(1);
}

const TASKS = [
  { name: "test-flow", emoji: "🧪", label: "Snabbtest" },
  { name: "check-site-status", emoji: "📊", label: "Sidkontroll" },
  { name: "monitor-stack", emoji: "🔍", label: "Stack Monitor" },
  { name: "start-booking-flow", emoji: "📋", label: "Bokningsflöde" },
  { name: "screenshot-page", emoji: "📸", label: "Screenshot" },
  { name: "test-booking-e2e", emoji: "✅", label: "E2E-test" },
  { name: "seo-audit", emoji: "🔎", label: "SEO Audit" },
  { name: "check-bookings", emoji: "📅", label: "Bokningar" },
];

// Build an HTML page with instructions and copy-paste commands
let html = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spick Agent – Mobil-setup</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0f;color:#e4e4ef;padding:20px;max-width:600px;margin:0 auto}
  h1{font-size:1.5rem;margin-bottom:8px}
  .sub{color:#8888a0;font-size:.9rem;margin-bottom:30px}
  .card{background:#1e1e2e;border:1px solid #2a2a3a;border-radius:14px;padding:18px;margin-bottom:12px}
  .card-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .card-head span{font-size:1.3rem}
  .card-head strong{font-size:1rem}
  .curl{background:#0a0a0f;border-radius:8px;padding:12px;font-family:monospace;font-size:.72rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all;color:#4ade80;margin-bottom:10px}
  .copy-btn{background:#2a2a3a;border:none;color:#e4e4ef;padding:8px 16px;border-radius:8px;font-size:.8rem;cursor:pointer;width:100%}
  .copy-btn:active{background:#4ade80;color:#0a0a0f}
  .section{font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#8888a0;margin:24px 0 12px}
  .guide{font-size:.85rem;line-height:1.6;color:#b0b0c0}
  .guide ol{padding-left:20px;margin:10px 0}
  .guide li{margin-bottom:8px}
  .url-box{background:#0a0a0f;border-radius:8px;padding:12px;font-family:monospace;font-size:.8rem;color:#60a5fa;margin:10px 0;word-break:break-all}
</style>
</head>
<body>
<h1>🧹 Spick Agent – Mobil-setup</h1>
<p class="sub">Skapa genvägar på din telefon för att trigga tasks</p>

<div class="section">Dashboard (enklast)</div>
<div class="card">
  <div class="guide">
    <p>Öppna denna URL i din mobil-browser och lägg till på hemskärmen:</p>
    <div class="url-box">${BASE_URL}/dashboard</div>
    <p>Logga in med din API-nyckel. Fungerar som en app.</p>
  </div>
</div>

<div class="section">iOS Shortcuts</div>
<div class="guide" style="margin-bottom:16px">
  <ol>
    <li>Öppna <strong>Genvägar</strong>-appen</li>
    <li>Tryck <strong>+</strong> → Ny genväg</li>
    <li>Lägg till: <strong>"Hämta innehåll i URL"</strong></li>
    <li>Klistra in curl-kommandot nedan som URL + headers</li>
    <li>Lägg till: <strong>"Visa resultat"</strong></li>
    <li>Namnge genvägen och lägg till på hemskärmen</li>
  </ol>
</div>
`;

for (const task of TASKS) {
  const curlCmd = `curl -X POST "${BASE_URL}/run-task" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${TOKEN}" \\
  -d '{"task":"${task.name}"}'`;

  html += `
<div class="card">
  <div class="card-head"><span>${task.emoji}</span><strong>${task.label}</strong></div>
  <div class="curl" id="curl-${task.name}">${curlCmd}</div>
  <button class="copy-btn" onclick="copy('curl-${task.name}')">Kopiera curl</button>
</div>`;
}

html += `
<div class="section">Android (HTTP Shortcuts-appen)</div>
<div class="card">
  <div class="guide">
    <ol>
      <li>Installera <strong>HTTP Shortcuts</strong> från Play Store</li>
      <li>Skapa ny genväg</li>
      <li>URL: <code>${BASE_URL}/run-task</code></li>
      <li>Metod: POST</li>
      <li>Header: <code>Authorization: Bearer ${TOKEN}</code></li>
      <li>Body: <code>{"task":"test-flow"}</code></li>
      <li>Lägg till widget på hemskärmen</li>
    </ol>
  </div>
</div>

<div class="section">API-info</div>
<div class="card">
  <div class="guide">
    <p><strong>Base URL:</strong></p>
    <div class="url-box">${BASE_URL}</div>
    <p><strong>Token:</strong></p>
    <div class="url-box">${TOKEN.slice(0, 8)}...${TOKEN.slice(-4)}</div>
  </div>
</div>

<script>
function copy(id){
  const text=document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(()=>{
    event.target.textContent='Kopierad ✓';
    setTimeout(()=>{event.target.textContent='Kopiera curl'},1500);
  });
}
</script>
</body>
</html>`;

const outPath = path.join(__dirname, "..", "logs", "mobile-setup.html");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);

console.log(`
✅ Mobile setup page generated!

Open in your browser:
  file://${outPath}

Or serve it:
  ${BASE_URL}/dashboard  (built-in dashboard)

Generated shortcuts for ${TASKS.length} tasks.
`);
