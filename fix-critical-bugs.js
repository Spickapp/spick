const fs = require('fs');
let fixes = 0;

// ═══════════════════════════════════════════════
// FILE 1: boka.html — Fix team visibility + company param
// ═══════════════════════════════════════════════
var b = fs.readFileSync('boka.html', 'utf8');

// 1a. Read ?company= and ?cleaner_id= params
var oldParams = "const preCleanerId   = p.get('id');";
var newParams = "const preCleanerId   = p.get('id') || p.get('cleaner_id');\n  var preCompanyId = p.get('company') || null;";
if (b.includes(oldParams) && !b.includes('preCompanyId')) {
  b = b.replace(oldParams, newParams);
  fixes++;
  console.log('FIX 1a OK - read company param');
}

// 1b. Replace team member filter with smart company logic
var oldFilter = "    // Filtrera bort teammedlemmar (har company_id men är inte ägare)\n    cleaners = cleaners.filter(c => !c.company_id || c.is_company_owner);";
var newFilter = `    // Company-filter: om ?company=ID, visa bara det företagets städare
    if (preCompanyId) {
      cleaners = cleaners.filter(c => c.company_id === preCompanyId && !c.owner_only);
    } else {
      // Visa alla: solo-städare + företagsstädare (ej owner_only)
      cleaners = cleaners.filter(c => !c.owner_only);
    }`;
if (b.includes(oldFilter)) {
  b = b.replace(oldFilter, newFilter);
  fixes++;
  console.log('FIX 1b OK - smart company filter');
}

// 1c. Show company name on ALL company members (not just owners)
var oldName = "cl.company_name && cl.is_company_owner ? ` <span";
var newName = "cl.company_name ? ` <span";
if (b.includes(oldName)) {
  b = b.replace(oldName, newName);
  fixes++;
  console.log('FIX 1c OK - show company name on all members');
}

// 1d. Add owner_only to the select query
var oldSelect = "company_name,completed_jobs,has_fskatt";
var newSelect = "company_name,completed_jobs,has_fskatt,owner_only";
if (b.includes(oldSelect) && !b.includes('owner_only')) {
  b = b.replace(oldSelect, newSelect);
  fixes++;
  console.log('FIX 1d OK - fetch owner_only field');
}

// 1e. Add company filter banner when ?company= is active
var oldSort = "// Sortera: betyg";
var newSort = `// Visa company-filter banner om aktivt
    if (preCompanyId && cleaners.length > 0) {
      var compName = cleaners[0].company_name || 'Företaget';
      var filterBanner = document.getElementById('company-filter-banner');
      if (!filterBanner) {
        filterBanner = document.createElement('div');
        filterBanner.id = 'company-filter-banner';
        filterBanner.style.cssText = 'padding:10px 16px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;font-size:.85rem';
        var listEl = document.getElementById('cleaner-list');
        if (listEl) listEl.parentElement.insertBefore(filterBanner, listEl);
      }
      filterBanner.innerHTML = '<span><strong>' + escHtml(compName) + '</strong> \\u2014 ' + cleaners.length + ' st\\u00e4dare</span><a href="boka.html" style="color:#1E40AF;font-size:.78rem;font-weight:600">Visa alla st\\u00e4dare \\u2192</a>';
    }
    // Sortera: betyg`;
if (b.includes(oldSort)) {
  b = b.replace(oldSort, newSort);
  fixes++;
  console.log('FIX 1e OK - company filter banner');
}

fs.writeFileSync('boka.html', b);

// ═══════════════════════════════════════════════
// FILE 2: stadare-dashboard.html — Fix hidePersonalSettings unicode
// ═══════════════════════════════════════════════
var d = fs.readFileSync('stadare-dashboard.html', 'utf8');

var oldHide = "text.includes('Sp\\\\u00e4rrade')";
var newHide = "text.includes('Sp\\u00e4rrade')";
// Try multiple patterns since escaping varies
var patterns = [
  ["text.includes('Sp\\\\u00e4rrade')", "text.includes('Sp\u00e4rrade')"],
  ["text.includes('Arbetspreferenser')", "text.includes('Arbetspreferenser')"], // this one is fine
  ["text.includes('Arbetsomr')", "text.includes('Arbetsomr')"], // partial match, should work
];

// Actually check what's in the file
var hideIdx = d.indexOf('function hidePersonalSettings');
if (hideIdx > -1) {
  var hideBlock = d.substring(hideIdx, hideIdx + 500);
  
  // Check if unicode is double-escaped
  if (hideBlock.includes('Sp\\u00e4rrade')) {
    // Already has unicode escape - the issue is these are in template literals
    // Actually in a regular string 'Sp\u00e4rrade' would be interpreted as 'Spärrade'
    // Let me check more carefully
    console.log('hidePersonalSettings found - checking unicode handling');
    
    // The real fix: use actual Swedish characters
    var oldFn = "function hidePersonalSettings() {\n  if (!cleaner || !cleaner.owner_only) return;\n  // Hide schedule, blocked dates, preferences, area, pricing\n  document.querySelectorAll('.settings-link').forEach(function(el) {\n    var text = el.textContent || '';\n    if (text.includes('Veckoschema') || text.includes('Sp\\u00e4rrade') || text.includes('Arbetspreferenser') || text.includes('Arbetsomr') || text.includes('Priss\\u00e4ttning')) {\n      el.style.display = 'none';\n    }\n  });\n}";
    
    var newFn = "function hidePersonalSettings() {\n  if (!cleaner || !cleaner.owner_only) return;\n  document.querySelectorAll('.settings-link').forEach(function(el) {\n    var text = el.textContent || '';\n    if (text.includes('Veckoschema') || text.includes('rrade') || text.includes('Arbetspreferenser') || text.includes('Arbetsomr') || text.includes('ttning per tj')) {\n      el.style.display = 'none';\n    }\n  });\n}";
    
    if (d.includes(oldFn)) {
      d = d.replace(oldFn, newFn);
      fixes++;
      console.log('FIX 2 OK - hidePersonalSettings unicode');
    } else {
      // Try simpler approach - just match partial strings that work regardless of encoding
      var simpleOld = "text.includes('Sp\\u00e4rrade')";
      var simpleNew = "text.includes('rrade')";
      if (d.includes(simpleOld)) {
        d = d.replace(simpleOld, simpleNew);
        fixes++;
        console.log('FIX 2 OK (simple) - Spärrade partial match');
      }
      
      var simpleOld2 = "text.includes('Priss\\u00e4ttning')";
      var simpleNew2 = "text.includes('ttning per tj')";
      if (d.includes(simpleOld2)) {
        d = d.replace(simpleOld2, simpleNew2);
        fixes++;
        console.log('FIX 2b OK - Prissättning partial match');
      }
    }
  }
}

fs.writeFileSync('stadare-dashboard.html', d);

console.log('Done - ' + fixes + ' fixes total');

// Fix 1d separately (backtick matching)
var b2 = fs.readFileSync('boka.html', 'utf8');
if (!b2.includes('has_fskatt,owner_only')) {
  b2 = b2.replace('completed_jobs,has_fskatt`', 'completed_jobs,has_fskatt,owner_only`');
  fs.writeFileSync('boka.html', b2);
  console.log('FIX 1d OK - added owner_only to select');
}
