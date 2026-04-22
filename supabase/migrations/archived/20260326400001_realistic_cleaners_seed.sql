-- ================================================================
-- Rensa fejk-städare och ersätt med realistisk demo-data
-- Korrekt services-format (TEXT[]), riktiga emails, riktig data
-- ================================================================

-- Ta bort befintliga fejk-städare
DELETE FROM cleaner_availability WHERE cleaner_id IN (SELECT id FROM cleaners);
DELETE FROM cleaners;

-- Sätt in realistiska demo-städare med korrekt datatyp på services
INSERT INTO cleaners (full_name, email, phone, city, bio, hourly_rate, services, status, avg_rating, review_count, jobs_completed, available, identity_verified, is_approved, created_at)
VALUES
  ('Olena Kovalenko',
   'olena.k@gmail.com',
   '+46701234501',
   'Stockholm',
   'Professionell städare med 5 års erfarenhet. Noggrann, pålitlig och punktlig. Specialiserad på hemstädning och storstädning.',
   330,
   ARRAY['Hemstädning','Storstädning'],
   'godkänd', 4.9, 23, 31, true, true, true, NOW() - INTERVAL '60 days'),

  ('Ahmed Hassan',
   'ahmed.h@gmail.com',
   '+46701234502',
   'Stockholm',
   'Erfaren städare med fokus på kvalitet. Pratar arabiska, svenska och engelska. Tillgänglig vardagar och helger.',
   320,
   ARRAY['Hemstädning','Kontorsstädning','Trapphus'],
   'godkänd', 4.8, 18, 24, true, true, true, NOW() - INTERVAL '45 days'),

  ('Maria Andersson',
   'maria.a@gmail.com',
   '+46701234503',
   'Solna',
   'Bor i Solna och täcker Stockholm-regionen. Erfaren inom hemstädning och flyttstädning. Använder miljövänliga produkter.',
   340,
   ARRAY['Hemstädning','Flyttstädning','Storstädning'],
   'godkänd', 4.7, 12, 16, true, true, true, NOW() - INTERVAL '30 days'),

  ('Fatima Al-Rashid',
   'fatima.r@gmail.com',
   '+46701234504',
   'Stockholm',
   'Specialiserar mig på djuprengöring och storstädning. 7 års erfarenhet. Noggrann och diskret.',
   360,
   ARRAY['Storstädning','Hemstädning','Fönsterputs'],
   'godkänd', 4.9, 31, 42, true, true, true, NOW() - INTERVAL '90 days'),

  ('Sara Lindqvist',
   'sara.l@gmail.com',
   '+46701234505',
   'Stockholm',
   'Energisk och noggrann städare. Bra med husdjur. Tillgänglig vardagar 08-17.',
   310,
   ARRAY['Hemstädning','Storstädning'],
   'godkänd', 4.6, 9, 11, true, true, true, NOW() - INTERVAL '20 days'),

  ('Kofi Mensah',
   'kofi.m@gmail.com',
   '+46701234506',
   'Sundbyberg',
   'Proffs inom kontorsstädning och hemstädning. Snabb och effektiv. Täcker hela Stockholm.',
   350,
   ARRAY['Hemstädning','Kontorsstädning','Trapphus'],
   'godkänd', 4.8, 14, 19, true, true, true, NOW() - INTERVAL '50 days'),

  ('Natasha Petrov',
   'natasha.p@gmail.com',
   '+46701234507',
   'Stockholm',
   'Ukrainsk städare med höga standarder. Expert på fönsterputs och flyttstädning.',
   370,
   ARRAY['Flyttstädning','Fönsterputs','Storstädning'],
   'godkänd', 4.9, 27, 35, true, true, true, NOW() - INTERVAL '75 days'),

  ('Mohammed Al-Farsi',
   'mohammed.f@gmail.com',
   '+46701234508',
   'Nacka',
   'Täcker Nacka, Värmdö och östra Stockholm. Flexibla tider. Erfaren inom alla typer av städning.',
   340,
   ARRAY['Hemstädning','Storstädning','Fönsterputs'],
   'godkänd', 4.7, 16, 22, true, true, true, NOW() - INTERVAL '40 days'),

  ('Anna-Lena Berg',
   'annalena.b@gmail.com',
   '+46701234509',
   'Bromma',
   'Professionell hemstädare sedan 10 år. Täcker Bromma, Vällingby och västra Stockholm.',
   360,
   ARRAY['Hemstädning','Storstädning','Kontorsstädning'],
   'godkänd', 5.0, 44, 58, true, true, true, NOW() - INTERVAL '120 days');

-- Ge alla städare korrekt veckoschema (mån-fre 08-17)
INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time, is_active)
SELECT c.id, d.day, '08:00'::time, '17:00'::time, true
FROM cleaners c
CROSS JOIN (VALUES (1),(2),(3),(4),(5)) AS d(day)
WHERE c.status = 'godkänd'
ON CONFLICT (cleaner_id, day_of_week) DO NOTHING;

-- Ge 3 städare även lördagar
INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time, is_active)
SELECT c.id, 6, '09:00'::time, '15:00'::time, true
FROM cleaners c
WHERE c.full_name IN ('Fatima Al-Rashid', 'Natasha Petrov', 'Anna-Lena Berg')
AND c.status = 'godkänd'
ON CONFLICT (cleaner_id, day_of_week) DO NOTHING;

SELECT 'Seed klar: ' || COUNT(*) || ' städare' AS status FROM cleaners WHERE status = 'godkänd';
