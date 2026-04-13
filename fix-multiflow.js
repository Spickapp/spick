const fs = require("fs");

// ═══ FIX 1: boka.html — skicka extra_windows i customer_notes ═══
const bokaPath = "C:\\Users\\farha\\spick\\boka.html";
let boka = fs.readFileSync(bokaPath, "utf8");

// Find where customer_notes is sent to booking-create
const notesPattern = "customer_notes: customer_notes || null,";
if (boka.includes("customer_notes,")) {
  // Find the doBook function where the fetch body is built
  const doBookIdx = boka.indexOf("service: state.service,");
  if (doBookIdx > -1) {
    // Find customer_notes in the payload near doBook
    const payloadArea = boka.substring(doBookIdx, doBookIdx + 1500);
    
    // Add extra windows info to notes
    const oldNotes = "customer_notes: customer_notes || null,";
    if (boka.includes(oldNotes)) {
      const newNotes = "customer_notes: ((customer_notes || '') + (state.extraWindows ? ' | Fönsterputs: ' + state.extraWindows + ' fönster' : '') + (state.services && state.services.length > 1 ? ' | Kombinerad tjänst: ' + state.services.join(' + ') : '')).trim() || null,";
      boka = boka.replace(oldNotes, newNotes);
      console.log("Fix 1a: extra_windows in customer_notes - OK");
    } else {
      console.log("Fix 1a: SKIP - customer_notes pattern not found in payload");
    }
  }
} else {
  console.log("Fix 1a: SKIP - no customer_notes found");
}

// Also make sure service sends the joined string (already does, but verify)
console.log("Fix 1b: service sends joined string:", boka.includes("service: state.service") ? "OK (already)" : "CHECK");

fs.writeFileSync(bokaPath, boka, "utf8");

// ═══ FIX 3: stadare-dashboard.html — checklist handles multi-service ═══
const dashPath = "C:\\Users\\farha\\spick\\stadare-dashboard.html";
let dash = fs.readFileSync(dashPath, "utf8");

// Find loadChecklist function
const clAnchor = "async function loadChecklist(bookingId, serviceType, companyId)";
if (dash.includes(clAnchor)) {
  // Find the query that fetches by service_type
  const oldQuery = "var url = SUPA + '/rest/v1/service_checklists?service_type=eq.' + encodeURIComponent(serviceType)";
  if (dash.includes(oldQuery)) {
    const newQuery = `// Handle combined services: "Storstädning + Fönsterputs" → try each
    var serviceTypes = serviceType.split(' + ').map(function(s) { return s.trim(); });
    var allItems = [];
    for (var si = 0; si < serviceTypes.length; si++) {
      var url = SUPA + '/rest/v1/service_checklists?service_type=eq.' + encodeURIComponent(serviceTypes[si])`;
    dash = dash.replace(oldQuery, newQuery);
    console.log("Fix 3a: checklist splits combined service - OK");
    
    // Now we need to close the loop and merge items
    // Find where template items are used
    const oldTemplateUse = "var items = (template.items || []).map(function(item) {";
    if (dash.includes(oldTemplateUse)) {
      const newTemplateUse = `}
    // If we got multiple checklists from combined services, merge them
    if (allItems.length > 0) {
      template = { id: checklists[0]?.id, items: allItems };
    }
    var items = (template.items || []).map(function(item) {`;
      // Actually this approach is getting too complex. Let me use a simpler approach.
    }
  }
  
  // Simpler approach: just replace the service_type query to use OR for split services
  // Revert the complex approach
  dash = fs.readFileSync(dashPath, "utf8");
  
  // Find: service_type=eq. and replace with a split-aware version
  const simpleOld = "var url = SUPA + '/rest/v1/service_checklists?service_type=eq.' + encodeURIComponent(serviceType)";
  if (dash.includes(simpleOld)) {
    const simpleNew = `var _svcParts = serviceType.split(' + ').map(function(s){return s.trim()});
    var _svcFilter = _svcParts.length > 1 
      ? 'service_type=in.(' + _svcParts.map(function(s){return encodeURIComponent('"'+s+'"')}).join(',') + ')'
      : 'service_type=eq.' + encodeURIComponent(serviceType);
    var url = SUPA + '/rest/v1/service_checklists?' + _svcFilter`;
    dash = dash.replace(simpleOld, simpleNew);
    console.log("Fix 3b: checklist query splits on + - OK");
  } else {
    console.log("Fix 3b: SKIP - checklist query not found");
  }
  
  // Also merge items from multiple checklists
  const oldTemplatePick = "var template = checklists.find(function(c) { return c.company_id === companyId; }) || checklists.find(function(c) { return !c.company_id; });";
  if (dash.includes(oldTemplatePick)) {
    const newTemplatePick = `var template = null;
    if (_svcParts.length > 1 && checklists.length > 1) {
      // Merge items from all matching checklists
      var mergedItems = [];
      _svcParts.forEach(function(svcName) {
        var match = checklists.find(function(c) { return c.service_type === svcName && c.company_id === companyId; }) 
                 || checklists.find(function(c) { return c.service_type === svcName && !c.company_id; });
        if (match && match.items) {
          mergedItems.push({ key: 'header_' + svcName, label: '— ' + svcName + ' —', isHeader: true });
          match.items.forEach(function(item) { mergedItems.push(item); });
        }
      });
      template = { id: checklists[0].id, items: mergedItems };
    } else {
      template = checklists.find(function(c) { return c.company_id === companyId; }) || checklists.find(function(c) { return !c.company_id; });
    }`;
    dash = dash.replace(oldTemplatePick, newTemplatePick);
    console.log("Fix 3c: merged checklist items - OK");
  } else {
    console.log("Fix 3c: SKIP - template pick not found");
  }
  
  fs.writeFileSync(dashPath, dash, "utf8");
} else {
  console.log("Fix 3: SKIP - loadChecklist not found");
}

// ═══ FIX 2: booking-create — split service for price lookup ═══
const bcPath = "C:\\Users\\farha\\spick\\supabase\\functions\\booking-create\\index.ts";
let bc = fs.readFileSync(bcPath, "utf8");

// Find the service price lookup
const oldPriceLookup = '.eq("service_type", service)';
if (bc.includes(oldPriceLookup)) {
  // Split service on " + " and use first for price lookup
  const newPriceLookup = '.eq("service_type", service.split(" + ")[0].trim())';
  bc = bc.replace(oldPriceLookup, newPriceLookup);
  console.log("Fix 2: booking-create splits service for price lookup - OK");
  fs.writeFileSync(bcPath, bc, "utf8");
} else {
  console.log("Fix 2: SKIP - service_type lookup not found in booking-create");
}

console.log("\n--- SUMMARY ---");
const finalBoka = fs.readFileSync(bokaPath, "utf8");
const finalDash = fs.readFileSync(dashPath, "utf8");
const finalBc = fs.readFileSync(bcPath, "utf8");

console.log("boka.html extra_windows:", finalBoka.includes("Fönsterputs: ") ? "OK" : "MISSING");
console.log("dashboard checklist split:", finalDash.includes("_svcParts") ? "OK" : "MISSING");
console.log("dashboard checklist merge:", finalDash.includes("mergedItems") ? "OK" : "MISSING");
console.log("booking-create price split:", finalBc.includes('split(" + ")[0]') ? "OK" : "MISSING");

const allOk = finalBoka.includes("Fönsterputs: ") && finalDash.includes("_svcParts") && finalBc.includes('split(" + ")[0]');
console.log(allOk ? "\nSUCCESS - all 3 fixes applied" : "\nPARTIAL - check logs");
