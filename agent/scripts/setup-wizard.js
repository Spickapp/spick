#!/usr/bin/env node
// scripts/setup-wizard.js – Interactive first-run setup
//
// Run: node scripts/setup-wizard.js
//
// Configures .env, generates API secret, tests Edge, opens dashboard.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { execSync } = require("child_process");

const ENV_PATH = path.join(__dirname, "..", ".env");
const ENV_EXAMPLE = path.join(__dirname, "..", ".env.example");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultVal = "") {
  const suffix = defaultVal ? ` [${defaultVal}]` : "";
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          🧹  Spick Agent – Setup Wizard             ║
╚══════════════════════════════════════════════════════╝
`);

  // Step 1: Check Node version
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1));
  if (major < 18) {
    console.log(`  ❌ Node.js ${nodeVer} – version 18+ krävs`);
    process.exit(1);
  }
  console.log(`  ✓ Node.js ${nodeVer}`);

  // Step 2: Check if npm packages installed
  const hasModules = fs.existsSync(path.join(__dirname, "..", "node_modules"));
  if (!hasModules) {
    console.log("  ⏳ Installerar npm-paket...");
    try {
      execSync("npm install", { cwd: path.join(__dirname, ".."), stdio: "inherit" });
      console.log("  ✓ Paket installerade");
    } catch {
      console.log("  ❌ npm install misslyckades");
      process.exit(1);
    }
  } else {
    console.log("  ✓ npm-paket redan installerade");
  }

  // Step 3: Check Playwright/Edge
  console.log("  ⏳ Kontrollerar Microsoft Edge...");
  try {
    execSync("npx playwright install msedge --dry-run", {
      cwd: path.join(__dirname, ".."),
      stdio: "pipe",
    });
    console.log("  ✓ Microsoft Edge redo");
  } catch {
    console.log("  ⏳ Installerar Edge för Playwright...");
    try {
      execSync("npx playwright install msedge", {
        cwd: path.join(__dirname, ".."),
        stdio: "inherit",
      });
      console.log("  ✓ Edge installerad");
    } catch {
      console.log("  ⚠ Kunde inte installera Edge automatiskt");
      console.log("    Kör manuellt: npx playwright install msedge");
    }
  }

  // Step 4: Configure .env
  console.log("\n── Konfiguration ──\n");

  let envContent = "";
  if (fs.existsSync(ENV_PATH)) {
    const overwrite = await ask("  .env finns redan. Skriva över? (ja/nej)", "nej");
    if (overwrite !== "ja") {
      console.log("  → Behåller befintlig .env");
      rl.close();
      printDone();
      return;
    }
  }

  // Read template
  envContent = fs.readFileSync(ENV_EXAMPLE, "utf-8");

  // Generate secret
  const secret = crypto.randomBytes(32).toString("hex");
  console.log(`\n  🔑 Genererad API-nyckel: ${secret.slice(0, 16)}...`);
  console.log("     (spara denna – du behöver den för mobilen)\n");

  envContent = envContent.replace(
    /API_SECRET=.*/,
    `API_SECRET=${secret}`
  );

  // Port
  const port = await ask("Port", "3500");
  envContent = envContent.replace(/PORT=.*/, `PORT=${port}`);

  // Headless
  const headless = await ask("Headless-läge? (true/false)", "false");
  envContent = envContent.replace(/HEADLESS=.*/, `HEADLESS=${headless}`);

  // ntfy
  const ntfy = await ask("ntfy.sh topic (lämna tomt för att skippa)", "");
  if (ntfy) {
    envContent = envContent.replace(/NTFY_TOPIC=.*/, `NTFY_TOPIC=${ntfy}`);
  }

  // Scheduler
  const sched = await ask("Aktivera schemaläggare? (true/false)", "false");
  envContent = envContent.replace(
    /SCHEDULER_ENABLED=.*/,
    `SCHEDULER_ENABLED=${sched}`
  );

  // Write .env
  fs.writeFileSync(ENV_PATH, envContent);
  console.log("\n  ✓ .env sparad\n");

  // Step 5: Get local IP
  try {
    const os = require("os");
    const nets = os.networkInterfaces();
    const localIPs = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === "IPv4" && !net.internal) {
          localIPs.push({ name, ip: net.address });
        }
      }
    }
    if (localIPs.length > 0) {
      console.log("  📡 Dina lokala IP-adresser:");
      for (const { name, ip } of localIPs) {
        console.log(`     ${ip} (${name})`);
      }
      const mainIP = localIPs[0].ip;
      console.log(`\n  📱 Dashboard-URL för mobilen:`);
      console.log(`     http://${mainIP}:${port}/dashboard\n`);

      // Save key info to a file
      const infoPath = path.join(__dirname, "..", "logs", "setup-info.txt");
      fs.mkdirSync(path.dirname(infoPath), { recursive: true });
      fs.writeFileSync(
        infoPath,
        [
          "Spick Agent – Setup Info",
          "========================",
          `Generated: ${new Date().toISOString()}`,
          "",
          `API Secret: ${secret}`,
          `Dashboard:  http://${mainIP}:${port}/dashboard`,
          `API Base:   http://${mainIP}:${port}`,
          "",
          "curl test:",
          `curl -X POST http://${mainIP}:${port}/run-task \\`,
          `  -H "Authorization: Bearer ${secret}" \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -d '{"task":"test-flow"}'`,
        ].join("\n")
      );
      console.log(`  💾 Setup-info sparad i logs/setup-info.txt`);
    }
  } catch {}

  rl.close();
  printDone();
}

function printDone() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║              ✅  Setup klar!                        ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Starta agenten:                                     ║
║    npm start                                         ║
║                                                      ║
║  Öppna dashboarden:                                  ║
║    http://localhost:3500/dashboard                    ║
║                                                      ║
║  Fjärråtkomst:                                       ║
║    npm run tunnel                                    ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);
}

main().catch((err) => {
  console.error("Setup error:", err);
  rl.close();
  process.exit(1);
});
