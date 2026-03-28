#!/usr/bin/env node
// scripts/test-trigger.js – Test the agent API from command line
//
// Usage:
//   node scripts/test-trigger.js                          # runs test-flow
//   node scripts/test-trigger.js start-booking-flow       # runs booking
//   node scripts/test-trigger.js check-site-status        # runs site check

const http = require("http");

const TASK = process.argv[2] || "test-flow";
const HOST = process.env.AGENT_HOST || "localhost";
const PORT = process.env.AGENT_PORT || 3500;
const TOKEN = process.env.API_SECRET || "spick_agent_s3cr3t_k3y_ch4ng3_m3";

const data = JSON.stringify({
  task: TASK,
  params: {},
});

console.log(`\n🚀 Triggering task: ${TASK}`);
console.log(`   → http://${HOST}:${PORT}/run-task\n`);

const req = http.request(
  {
    hostname: HOST,
    port: PORT,
    path: "/run-task",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      "Content-Length": Buffer.byteLength(data),
    },
    timeout: 130000,
  },
  (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`Status: ${res.statusCode}`);
      try {
        const json = JSON.parse(body);
        console.log(JSON.stringify(json, null, 2));
      } catch {
        console.log(body);
      }
    });
  }
);

req.on("error", (err) => {
  console.error("❌ Connection failed:", err.message);
  console.error("   Is the agent running? Start it with: npm start");
});

req.on("timeout", () => {
  console.error("❌ Request timed out (130s)");
  req.destroy();
});

req.write(data);
req.end();
