# Archived migrations

Denna katalog innehåller migrationsfiler som skapats men medvetet INTE applicerats i prod. De bevaras som designreferens för framtida fas-arbete, men får INTE köras utan att först valideras mot aktuell primärkälla (API-spec, schema, regulator-regler).

## Filer

### `rut-sprint-1-deferred-to-fas-7-5.sql`

**Ursprung:** commit `0b82f2d` (2026-04-23 förmiddag), Sprint RUT.1.
**Status:** Pausad 2026-04-23 kväll. Ej applicerad i prod.
**Anledning:** Byggd utan §7.5.1 Skatteverket-API-spec-research. Överträdde scope-gränser i [docs/audits/2026-04-23-rut-infrastructure-decision.md](../../audits/2026-04-23-rut-infrastructure-decision.md).

**Om Fas 7.5-arbete startar:** Filen kan användas som designreferens för 21-kolumners-tillägget + 3 nya tabeller (customer_pnr_access_log, rut_skv_payouts, rut_payout_allocations). MÅSTE valideras mot faktisk Skatteverket RUT API-spec 2026 innan körning. Ignorera designval om de inte matchar specen.

**Får ALDRIG köras:** `supabase db push` eller manuell Studio-exekvering utan fullständig §7.5.1-research dokumenterad.
