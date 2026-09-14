-- Division notice board: a short, division-wide announcement shown between
-- the division name and its task list on the grouped tasks list. Editing is
-- a head power (Super Admin, OSD, the division's head, or an active
-- delegate) — see canEditDivisionNotice in src/lib/rbac/rules.ts.
--
-- Idempotent by design: safe on a fresh database and on one that may already
-- carry this column from `db push` drift.
ALTER TABLE "divisions" ADD COLUMN IF NOT EXISTS "notice_board" TEXT;
