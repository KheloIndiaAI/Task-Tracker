-- Personal-task visibility: a per-user, Super-Admin-managed grant to read
-- OTHER people's personal tasks across the divisions the user belongs to or
-- heads. Super Admin and OSD read personal tasks by role and are unaffected by
-- this flag; for everyone else it is the single switch, surfaced as the
-- "Personal task visibility" toggle on Users > Create / Edit.
--
-- Idempotent by design: safe on a fresh database and on one that may already
-- carry the column from `db push` drift.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_see_personal_tasks" BOOLEAN NOT NULL DEFAULT false;

-- Backfill so nobody silently loses access the moment this ships. Before this
-- migration the grant was hard-coded to Director and Under Secretary, plus any
-- division head. Deputy Secretary is added here as an explicit decision
-- (2026-09-07) — it sits above Under Secretary and was omitted by oversight.
UPDATE "users"
   SET "can_see_personal_tasks" = true
 WHERE "hierarchy_slot" IN ('director', 'deputy_secretary', 'under_secretary');

-- Anyone currently heading a division kept personal visibility of it under the
-- previous rule regardless of slot, so carry those users over too.
UPDATE "users"
   SET "can_see_personal_tasks" = true
 WHERE "id" IN (
   SELECT "head_user_id" FROM "divisions" WHERE "head_user_id" IS NOT NULL
 );
