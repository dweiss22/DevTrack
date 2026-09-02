-- Wrike display names can carry diacritics (e.g. accented letters) that are
-- absent from the same person's name as typed into a task's ID/SME custom
-- field, or vice versa. The strict exact-match assignment matching introduced
-- in 202607280005 compared these values byte-for-byte after only
-- lowercasing/whitespace-collapsing, so an accent mismatch made a verified,
-- active Wrike identity permanently unmatchable: excluded from the
-- selectable "assigned" list (dashboard missing) and simultaneously flagged
-- as an "unverified assignment value" needing correction. Fold accents out
-- via unaccent() so both sides compare on the same normalized form.

create or replace function public.normalize_project_assignment_name(value text)
returns text
language sql
immutable
parallel safe
set search_path=public,extensions
as $$
  select lower(regexp_replace(extensions.unaccent(coalesce(btrim(value),'')),'\s+',' ','g'));
$$;

select pg_notify('pgrst','reload schema');
