-- Report Generation access: a per-user grant to generate the Priority Task
-- Report PDF from /tasks. Super Admin, OSD, and division heads have this by
-- role already; this flag only ever widens who else can (the "Report
-- generation access" toggle on Users > Create / Edit).
--
-- Idempotent by design: safe on a fresh database and on one that may already
-- carry this column from `db push` drift.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_generate_reports" BOOLEAN NOT NULL DEFAULT false;
