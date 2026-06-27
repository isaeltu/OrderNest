-- Adds optional visual layout data to restaurant_tables so the admin/waiter "Mesas"
-- screen can offer a second, free-form floor plan view alongside the existing list view.
-- All new columns are nullable or defaulted so existing rows and queries are unaffected.

alter table public.restaurant_tables
  add column if not exists shape text not null default 'rect' check (shape in ('circle', 'rect', 'bar')),
  add column if not exists pos_x numeric,
  add column if not exists pos_y numeric,
  add column if not exists width numeric not null default 140,
  add column if not exists height numeric not null default 110;
