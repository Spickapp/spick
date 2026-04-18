# admin.html:3286 — `AR.upsert` är inte en funktion

**Prioritet:** P1 — funktionen kraschar runtime
**Estimat:** 15-30 min

---

## Problem

[admin.html:3286](../../admin.html:3286) i `saveAdminPrices()` anropar:

```js
await AR.upsert('cleaner_service_prices', {
  cleaner_id: cleanerId,
  service_type: svc,
  price_type: priceType,
  price: price
});
```

Men AR-klienten ([admin.html:1240-1265](../../admin.html:1240)) definierar bara fyra metoder: `select`, `update`, `insert`, `del`. **Ingen `upsert`.**

Upptäckt under Fas 0.4a scope-verifiering (rapport 2026-04-18 sen kväll, grep `AR.upsert`). Funktionen kastar `TypeError: AR.upsert is not a function` när admin trycker på "💾 Spara priser" i städarpanelen.

Grep `onConflict` i admin.html ger 0 träffar — det finns ingen annan upsert-pattern i admin-flödet. Enda upsert utanför AR i frontend är [mitt-konto.html:805-812](../../mitt-konto.html:805) via `SB.from().upsert(..., { onConflict })` (officiell supabase-js-klient, inte AR).

---

## Fix-alternativ

### A) DELETE + INSERT-pattern (som Fas 0.4a)

Minimalt scope. Matchar mönstret i [admin.html:3970 `adminSaveSchedule`](../../admin.html:3970). För priser per `(cleaner_id, service_type)` blir det:

```js
await AR.del('cleaner_service_prices',
  'cleaner_id=eq.' + cleanerId + '&service_type=eq.' + encodeURIComponent(svc));
await AR.insert('cleaner_service_prices', { cleaner_id, service_type, price_type, price });
```

### B) Utöka AR med `upsert(table, data, conflictCols)`

Lägg till metod i AR-klienten som skickar `Prefer: resolution=merge-duplicates` + `?on_conflict=col1,col2`. Reparerar både `saveAdminPrices` och skulle tillåta framtida flöden att använda upsert direkt.

Signatur-förslag:
```js
async upsert(table, data, conflictCols) {
  const r = await fetch(SPICK.SUPA_URL + '/rest/v1/' + table +
    (conflictCols ? '?on_conflict=' + conflictCols : ''), {
    method: 'POST',
    headers: { ...await _adminHeaders(),
               'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(data)
  });
  return { error: r.ok ? null : { message: 'HTTP ' + r.status } };
}
```

Kräver UNIQUE-constraint på (cleaner_id, service_type) för PostgREST att veta hur merge ska lösas — verifiera schema innan denna väg väljs.

---

## Rekommendation

**Väg A** (DELETE + INSERT) för att matcha 0.4a-stil och hålla scope minimal. Väg B är rätt långsiktigt om fler upsert-behov uppstår, men då är det ett AR-klient-refaktor som bör göras separat.

---

## Källa

Upptäckt 2026-04-18 sen kväll under grep-verifiering för Fas 0.4a. Fas 0.4a valde att använda `AR.del` + `AR.insert` istället för att röra AR-klienten — samma bugg (AR.upsert saknas) gäller för priser men åtgärdas inte inom 0.4a-scope.
