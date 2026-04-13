const fs = require("fs");
const filepath = "C:\\Users\\farha\\spick\\boka.html";
let c = fs.readFileSync(filepath, "utf8");

// Fix 1: Replace state.service = name with multi-toggle logic
const old1 = "function selectService(name, icon, desc, time) {\n  state.service = name;";
const new1 = `function selectService(name, icon, desc, time) {
  // Multi-service toggle
  if (!state.services) state.services = [];
  var idx = state.services.indexOf(name);
  if (idx > -1) {
    state.services.splice(idx, 1);
  } else {
    if (state.services.length >= 3) state.services.shift();
    state.services.push(name);
  }
  state.service = state.services.join(' + ') || '';`;

if (c.includes(old1)) {
  c = c.replace(old1, new1);
  console.log("Fix 1: toggle logic - OK");
} else {
  console.log("Fix 1: SKIP - pattern not found");
}

// Fix 2: Replace single-select toggle with multi-select
const old2 = "b.classList.toggle('selected', b.dataset.svc === name);";
const new2 = "b.classList.toggle('selected', (state.services || []).indexOf(b.dataset.svc) > -1);";

if (c.includes(old2)) {
  c = c.replace(old2, new2);
  console.log("Fix 2: multi-select UI - OK");
} else {
  console.log("Fix 2: SKIP - pattern not found");
}

fs.writeFileSync(filepath, c, "utf8");

// Verify
const final = fs.readFileSync(filepath, "utf8");
console.log("\nMulti-toggle:", final.includes("state.services.indexOf(name)"));
console.log("Multi-select UI:", final.includes("(state.services || []).indexOf(b.dataset.svc)"));
console.log(final.includes("state.services.indexOf(name)") && final.includes("(state.services || []).indexOf(b.dataset.svc)") ? "SUCCESS" : "FAILED");
