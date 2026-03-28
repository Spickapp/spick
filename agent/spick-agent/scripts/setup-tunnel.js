#!/usr/bin/env node
// scripts/setup-tunnel.js – Setup Cloudflare Tunnel for remote access
//
// Quick tunnel (temporary URL, no account):
//   node scripts/setup-tunnel.js
//
// Named tunnel (permanent URL, needs account):
//   node scripts/setup-tunnel.js named

const { execSync, spawn } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3500;
const mode = process.argv[2] || "quick";

function isInstalled() {
  try {
    execSync("cloudflared --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function printInstallInstructions() {
  const platform = os.platform();
  console.log("\n❌ cloudflared is not installed.\n");

  if (platform === "win32") {
    console.log("Install on Windows:");
    console.log("  winget install cloudflare.cloudflared");
    console.log("  -- OR --");
    console.log("  Download: https://github.com/cloudflare/cloudflared/releases/latest");
    console.log("  Get: cloudflared-windows-amd64.exe → rename to cloudflared.exe → add to PATH\n");
  } else if (platform === "darwin") {
    console.log("Install on macOS:");
    console.log("  brew install cloudflare/cloudflare/cloudflared\n");
  } else {
    console.log("Install on Linux:");
    console.log("  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared");
    console.log("  chmod +x /usr/local/bin/cloudflared\n");
  }
  console.log("After installing, run this script again.");
  process.exit(1);
}

function startQuickTunnel() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           🌐  Starting Cloudflare Quick Tunnel            ║
╠═══════════════════════════════════════════════════════════╣
║  Creates a temporary public HTTPS URL.                    ║
║  No account needed. URL changes on restart.               ║
║  For permanent URL: node scripts/setup-tunnel.js named    ║
╚═══════════════════════════════════════════════════════════╝
  `);

  const tunnel = spawn("cloudflared", ["tunnel", "--url", "http://localhost:" + PORT], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let urlFound = false;

  const handleOutput = (data) => {
    const text = data.toString();
    const urlMatch = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (urlMatch && !urlFound) {
      urlFound = true;
      const url = urlMatch[0];
      console.log("✅ Tunnel is live!\n");
      console.log("   Public URL:     " + url);
      console.log("   Dashboard:      " + url + "/dashboard");
      console.log("   Health check:   " + url + "/health");
      console.log("\n   Example – trigger from phone:");
      console.log("   curl -X POST " + url + "/run-task \\");
      console.log('     -H "Authorization: Bearer YOUR_SECRET" \\');
      console.log('     -H "Content-Type: application/json" \\');
      console.log("     -d '{\"task\": \"test-flow\"}'");

      const logDir = path.join(__dirname, "..", "logs");
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(
        path.join(logDir, "tunnel-url.txt"),
        url + "\nCreated: " + new Date().toISOString() + "\n"
      );
      console.log("\n   URL saved to logs/tunnel-url.txt");
      console.log("   Press Ctrl+C to stop.\n");
    }
  };

  tunnel.stdout.on("data", handleOutput);
  tunnel.stderr.on("data", handleOutput);

  tunnel.on("close", (code) => {
    console.log("\nTunnel closed (code: " + code + ")");
  });

  process.on("SIGINT", () => {
    console.log("\nShutting down tunnel...");
    tunnel.kill("SIGTERM");
    setTimeout(() => process.exit(0), 1000);
  });
}

function setupNamedTunnel() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         🌐  Named Cloudflare Tunnel Setup Guide           ║
╠═══════════════════════════════════════════════════════════╣
║  Permanent URL that doesn't change across restarts.       ║
║  Requires a free Cloudflare account + domain.             ║
╚═══════════════════════════════════════════════════════════╝

Steps:

1. Login to Cloudflare:
   cloudflared tunnel login

2. Create tunnel:
   cloudflared tunnel create spick-agent

3. Route DNS (replace DOMAIN):
   cloudflared tunnel route dns spick-agent agent.DOMAIN.com

4. Create config (~/.cloudflared/config.yml):

   tunnel: spick-agent
   credentials-file: ~/.cloudflared/<TUNNEL-ID>.json
   ingress:
     - hostname: agent.DOMAIN.com
       service: http://localhost:${PORT}
     - service: http_status:404

5. Start:
   cloudflared tunnel run spick-agent

6. Auto-start as service:
   cloudflared service install

Your agent: https://agent.DOMAIN.com/dashboard
  `);
}

if (!isInstalled()) printInstallInstructions();
if (mode === "named") setupNamedTunnel();
else startQuickTunnel();
