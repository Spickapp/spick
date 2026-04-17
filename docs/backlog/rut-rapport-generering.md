# RUT-rapport-generering (P1 — ej klart)

## Nuvarande tid-tracking i prod

Cleaner klickar "KLAR" i `team-jobb.html` eller motsv. Sätter atomiskt:
- `status = 'klar'`
- `completed_at = NOW()`
- `checkout_time = NOW()`
- `actual_hours = (checkout_time - checkin_time) / 3600`

Skatteverkets RUT-rapport ska läsa:
- `checkin_time` som faktisk start
- `checkout_time` som faktisk slut
- `actual_hours` som dokumenterad arbetstid

Ingen booking-time-tracker EF behövs.

## Kvar att bygga

- RUT-rapport-vy som exporterar HUS-fil (Skatteverkets XML)
- P1-prioritet, ej blocker för Solid Service-pilot
