// ═══════════════════════════════════════════════════════════════
// SPICK – Google Places address autocomplete
// Proxy via Supabase Edge Function (undviker CORS + döljer API-nyckel)
// ═══════════════════════════════════════════════════════════════

function initAddressAutocomplete(inputId, onSelect, opts) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const dropdownId = (opts && opts.dropdownId) || null;
  const typesParam = (opts && opts.types) || 'address';
  let dropdown = dropdownId ? document.getElementById(dropdownId) : null;
  let debounceTimer = null;
  let isCustomDropdown = false;

  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    const val = this.value.trim();
    if (val.length < 3) { hideDropdown(); return; }
    debounceTimer = setTimeout(() => fetchSuggestions(val), 300);
  });

  input.addEventListener('focus', function () {
    if (this.value.trim().length >= 3) fetchSuggestions(this.value.trim());
  });

  async function fetchSuggestions(query) {
    try {
      const res = await fetch(SPICK.SUPA_URL + '/functions/v1/places-autocomplete', {
        method: 'POST',
        headers: SPICK_HEADERS,
        body: JSON.stringify({ query: query, country: 'se', types: typesParam }),
      });
      const data = await res.json();
      showDropdown(data.predictions || []);
    } catch (e) {
      console.error('[SPICK] places-autocomplete:', e.message);
      hideDropdown();
    }
  }

  function showDropdown(predictions) {
    if (!predictions.length) { hideDropdown(); return; }

    if (!dropdown) {
      dropdown = document.createElement('div');
      isCustomDropdown = true;
      dropdown.className = 'addr-suggestions';
      dropdown.style.cssText =
        'position:absolute;z-index:50;background:#fff;border:1.5px solid var(--border,#ddd);' +
        'border-radius:0 0 9px 9px;max-height:240px;overflow-y:auto;left:0;right:0;top:100%;';
      input.parentElement.style.position = 'relative';
      input.parentElement.appendChild(dropdown);
    }

    dropdown.innerHTML = predictions.map(function (p) {
      return '<div class="addr-item" data-desc="' + escHtml(p.description) + '" data-pid="' + escHtml(p.place_id) + '">'
        + escHtml(p.description) + '</div>';
    }).join('');
    dropdown.style.display = 'block';
  }

  function hideDropdown() {
    if (dropdown) dropdown.style.display = 'none';
  }

  // Delegated click on items
  (dropdown || document).addEventListener('click', function (e) {
    var item = e.target.closest('.addr-item');
    if (!item) return;
    var desc = item.getAttribute('data-desc');
    var pid = item.getAttribute('data-pid');
    input.value = desc;
    hideDropdown();
    if (onSelect) onSelect(desc, pid);
  });

  // Close on outside click
  document.addEventListener('click', function (e) {
    if (!input.contains(e.target) && !(dropdown && dropdown.contains(e.target))) {
      hideDropdown();
    }
  });
}
