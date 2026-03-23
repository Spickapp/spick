-- Lägg till nya kolumner i cleaner_applications
alter table cleaner_applications
  add column if not exists has_insurance boolean default false,
  add column if not exists accepts_keys boolean default false;
