-- "Latest status" panel: a short free-text update shown above Context on the
-- task detail page. The 50-word cap is application-level (Zod, in
-- updateTaskFieldsAction) rather than a database constraint, matching how
-- description's 5000-character cap is enforced — the column itself is
-- unbounded TEXT.
--
-- Idempotent by design: safe on a fresh database and on one that may already
-- carry this column from `db push` drift.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "latest_status" TEXT;
