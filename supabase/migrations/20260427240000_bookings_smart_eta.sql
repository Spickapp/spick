-- ═══════════════════════════════════════════════════════════════
-- SPICK – bookings Smart-ETA-kolumner ("På väg" + ETA + delay)
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- När städare trycker "På väg" i dashboard ska systemet:
--   1) Anropa OSRM-routing (drive-time från städare → kund-adress)
--   2) Sätta cleaner_on_way_at + cleaner_eta_at + cleaner_eta_minutes
--   3) Skicka SMS till kund via _shared/notifications.notify()
--   4) Logga event i booking_events
-- VD/städare kan dessutom manuellt sätta "X min försening" → ETA
-- räknas om och nytt SMS går ut. Cron eta-monitor påminner städare
-- 15 min innan starttid + eskalerar no-show-risk till VD/admin.
--
-- REGLER #26-#33
--   #26 grep-före-edit:   bekräftat — inga befintliga *_eta_*-kolumner
--   #27 scope-respekt:    enbart Smart-ETA-fält + 2 indexes (ingen
--                         ändring av befintliga kolumner)
--   #28 SSOT:             cleaner_eta_source som enum-text (osrm |
--                         manual | predictive | fallback_haversine) —
--                         enforcas via CHECK constraint, inte sträng-magi
--                         i koden
--   #31 Curl-verified:    bookings.cleaner_on_way_at saknas i prod
--                         (HTTP 400). Övriga 9 kolumner härleds från
--                         samma sanning (ej i 00005_bookings.sql, ej
--                         tillagda i någon senare ALTER TABLE).
-- ═══════════════════════════════════════════════════════════════

-- ── Smart-ETA-kolumner ─────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cleaner_on_way_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleaner_eta_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleaner_eta_minutes      INTEGER,
  ADD COLUMN IF NOT EXISTS cleaner_eta_distance_km  NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS cleaner_eta_source       TEXT,
  ADD COLUMN IF NOT EXISTS predicted_arrival_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_delay_minutes     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_notification_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_eta_update_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delay_status             TEXT DEFAULT 'on_time';

-- ── Geocodade kund-koordinater (för OSRM-routing) ─────────────
-- bookings.customer_address är text; för Smart-ETA + future
-- distance-matching behöver vi cached lat/lng. geo-EF redan PATCHar
-- {lat, lng} (geo/index.ts:11) men kolumnerna fanns inte — det
-- silent-failade. Vi lägger till NULL-safe coords här.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_lat  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS customer_lng  DOUBLE PRECISION;

-- ── CHECK constraints ──────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_delay_status_check') THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_delay_status_check
      CHECK (delay_status IN ('on_time', 'minor_delay', 'major_delay', 'no_show_risk'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cleaner_eta_source_check') THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_cleaner_eta_source_check
      CHECK (cleaner_eta_source IS NULL OR cleaner_eta_source IN ('osrm', 'manual', 'predictive', 'fallback_haversine'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_manual_delay_minutes_check') THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_manual_delay_minutes_check
      CHECK (manual_delay_minutes >= 0 AND manual_delay_minutes <= 240);
  END IF;
END $$;

-- ── Kommentarer (svenska, kort syfte) ─────────────────────────
COMMENT ON COLUMN public.bookings.cleaner_on_way_at IS
  'Tidpunkt när städare tryckte "På väg" i dashboard. NULL = inte avgått än.';
COMMENT ON COLUMN public.bookings.cleaner_eta_at IS
  'Beräknad ankomsttid (cleaner_on_way_at + drive-time + manual_delay_minutes).';
COMMENT ON COLUMN public.bookings.cleaner_eta_minutes IS
  'Drive-time i minuter från sista kända städare-position till kund-adress.';
COMMENT ON COLUMN public.bookings.cleaner_eta_distance_km IS
  'Drive-distans i km. Visa i UI ("12 km bort"). NULL för manual-source.';
COMMENT ON COLUMN public.bookings.cleaner_eta_source IS
  'Källa till ETA: osrm (OSRM-routing), fallback_haversine (OSRM nere), manual (VD/städare-input), predictive (företags-schemalagd nästa-jobb-uppskattning).';
COMMENT ON COLUMN public.bookings.predicted_arrival_at IS
  'Företags-VD pre-set: när VD vet att städare har tidigare jobb och kommer från det. Används som baseline INNAN "På väg" trycks.';
COMMENT ON COLUMN public.bookings.manual_delay_minutes IS
  'Override-försening (0-240 min) från VD eller städare. Adderas till cleaner_eta_at vid uppdatering.';
COMMENT ON COLUMN public.bookings.delay_notification_count IS
  'Antal SMS/notifikationer skickade till kund om denna förseningen. Förhindrar spam.';
COMMENT ON COLUMN public.bookings.last_eta_update_at IS
  'Senaste tidpunkt ETA räknades om. Används av eta-monitor cron för dedup.';
COMMENT ON COLUMN public.bookings.delay_status IS
  'Status-flagga för UI/monitoring: on_time | minor_delay (>15min) | major_delay (>30min) | no_show_risk (>60min).';
COMMENT ON COLUMN public.bookings.customer_lat IS
  'Kund-adress geocoded (Nominatim via geo-EF). NULL tills first geocode. Krävs för OSRM-routing i cleaner-eta-update.';
COMMENT ON COLUMN public.bookings.customer_lng IS
  'Kund-adress geocoded (longitude). Se customer_lat.';

-- ── Index: aktiva ETAs (för dashboards + cron eta-monitor) ────
CREATE INDEX IF NOT EXISTS idx_bookings_active_eta
  ON public.bookings (booking_date, cleaner_on_way_at)
  WHERE cleaner_on_way_at IS NOT NULL
    AND status IN ('confirmed', 'bekräftad', 'pending_confirmation');

-- ── Index: predicted-arrival för company-pre-setup ────────────
CREATE INDEX IF NOT EXISTS idx_bookings_predicted_arrival
  ON public.bookings (predicted_arrival_at)
  WHERE predicted_arrival_at IS NOT NULL
    AND status IN ('confirmed', 'bekräftad', 'pending_confirmation');

-- ── PostgREST schema-reload ───────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── Verifierings-summary ──────────────────────────────────────
DO $$
DECLARE
  v_on_way    BOOLEAN;
  v_eta_at    BOOLEAN;
  v_eta_src   BOOLEAN;
  v_delay     BOOLEAN;
  v_lat       BOOLEAN;
  v_idx_eta   BOOLEAN;
  v_idx_pred  BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings' AND column_name='cleaner_on_way_at') INTO v_on_way;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings' AND column_name='cleaner_eta_at') INTO v_eta_at;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings' AND column_name='cleaner_eta_source') INTO v_eta_src;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings' AND column_name='delay_status') INTO v_delay;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings' AND column_name='customer_lat') INTO v_lat;
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_bookings_active_eta') INTO v_idx_eta;
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_bookings_predicted_arrival') INTO v_idx_pred;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 20260427240000 — bookings Smart-ETA';
  RAISE NOTICE '  cleaner_on_way_at:        %', CASE WHEN v_on_way    THEN 'OK' ELSE 'FAIL' END;
  RAISE NOTICE '  cleaner_eta_at:           %', CASE WHEN v_eta_at    THEN 'OK' ELSE 'FAIL' END;
  RAISE NOTICE '  cleaner_eta_source:       %', CASE WHEN v_eta_src   THEN 'OK' ELSE 'FAIL' END;
  RAISE NOTICE '  delay_status:             %', CASE WHEN v_delay     THEN 'OK' ELSE 'FAIL' END;
  RAISE NOTICE '  customer_lat / lng:       %', CASE WHEN v_lat       THEN 'OK' ELSE 'FAIL' END;
  RAISE NOTICE '  idx_bookings_active_eta:  %', CASE WHEN v_idx_eta   THEN 'OK' ELSE 'FAIL' END;
  RAISE NOTICE '  idx_bookings_predicted:   %', CASE WHEN v_idx_pred  THEN 'OK' ELSE 'FAIL' END;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
