-- 202608310005 tried to widen the audit table's operational_role check, but
-- its explicit constraint name was long enough to be silently truncated by
-- Postgres to a DIFFERENT 63-char identifier than the one Postgres itself
-- auto-generated for the table's original inline check constraint. That left
-- both constraints in place: the new permissive one, and the original
-- ('id' only) one still enforcing. Drop both by their actual (truncated)
-- names and replace with a single, explicitly short-named constraint so this
-- can't happen again.
alter table public.application_user_operational_persona_audit
  drop constraint if exists application_user_operational_persona_aud_operational_role_check,
  drop constraint if exists application_user_operational_persona_audit_operational_role_che,
  add constraint persona_audit_operational_role_check check (operational_role in ('id','sme','project_reviewer'));
