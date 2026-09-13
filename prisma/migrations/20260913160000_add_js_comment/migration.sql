-- "JS Comment": a free-text field shown alongside Latest status on the grouped
-- tasks list's Daily/Weekly/Fortnight/Monthly board. Edit right is Super Admin
-- OR the new per-user can_add_js_comment grant (surfaced as the "JS Comment
-- access" toggle on Users > Create / Edit, mirroring can_see_personal_tasks).
-- No backfill: off by default for everyone including leadership, since Super
-- Admin already has the right unconditionally and this flag only ever widens
-- who else gets it.
--
-- Idempotent by design: safe on a fresh database and on one that may already
-- carry these columns from `db push` drift.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "js_comment" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_add_js_comment" BOOLEAN NOT NULL DEFAULT false;
