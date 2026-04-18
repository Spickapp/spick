# Wizard tillåter dublicering av företagsnamn

**Upptäckt:** 2026-04-18 (under Fas 0.5-testförberedelser)
**Prioritet:** P2 — orsakar manuell rensning men ingen dataförlust
**Estimat:** 30-45 min inkl 409-flow + UI-confirm

---

## Symptom

Wizarden la bara `-2` på sluggen utan varning när "Solid Service Sverige AB" skapades en andra gång med annat org.nr. Resultat: dublett-företag i prod som fick rensas manuellt.

---

## Rotorsak

[admin-create-company/index.ts:46-52](../../supabase/functions/admin-create-company/index.ts:46) gör ren slug-uniquering:

```ts
const baseSlug = (body.company_name || "foretag")
  .toLowerCase()
  .replace(/[åä]/g, "a").replace(/ö/g, "o")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const { data: slugExists } = await sb.from("companies").select("id").like("slug", baseSlug + "%");
const companySlug = slugExists?.length ? baseSlug + "-" + (slugExists.length + 1) : baseSlug;
```

Sluggen blir unik, men `name`-kolumnen kontrolleras inte. `org_number` kontrolleras inte heller. Så ett företag kan skapas med samma namn + samma eller annat orgnr, så länge sluggen inte krockar.

---

## Fix-förslag för Fas 1

I `admin-create-company/index.ts` innan `INSERT`:

- Kolla om `companies`-rad med samma `name` (case-insensitive) eller samma `org_number` existerar
- Returnera `409 Conflict` med vänlig fråga: "Företag med detta namn finns redan (slug: xxx). Vill du skapa ändå? Bekräfta org.nr."

Skiss:

```ts
// Pre-flight duplicate-check
const { data: dupByName } = await sb.from("companies")
  .select("id, slug, org_number")
  .ilike("name", body.company_name)
  .limit(1);

const { data: dupByOrg } = body.org_number
  ? await sb.from("companies").select("id, slug, name").eq("org_number", body.org_number).limit(1)
  : { data: [] };

if ((dupByName?.length || dupByOrg?.length) && !body.confirm_duplicate) {
  return json(409, {
    error: "duplicate_candidate",
    existing: { byName: dupByName?.[0], byOrg: dupByOrg?.[0] },
    hint: "Skicka confirm_duplicate: true om avsikten är att ändå skapa."
  });
}
```

Frontend (admin.html Wizard) fångar 409 och visar bekräftelse-modal med existerande rads data innan re-skick med `confirm_duplicate: true`.

---

## Källa

Upptäckt 2026-04-18 när testa-flöde krävde att skapa Solid Service Sverige AB två gånger. Första raden skapades, sen ny slug `solid-service-sverige-ab-2` utan varning. Fel är lågriskigt men förvirrande för admin.
