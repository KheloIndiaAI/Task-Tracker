-- Two Super-Admin-managed grants on Users, both off for everyone:
--
--   can_edit_latest_status — write the Status line on the tasks list's
--       Daily/Weekly/Fortnight/Monthly board (tasks.latest_status, the same
--       field as the task page's Latest status).
--   can_schedule_tasks     — put a task, including an unscheduled one, into
--       the Daily / Weekly / Fortnight / Monthly / Watchlist lanes.
--
-- Each only ever WIDENS who may do something others already could (owners,
-- collaborators and heads for the status line; Super Admin, OSD, Director
-- grade and heads for the lanes), and only over tasks the holder can already
-- see. Nobody gains anything from this migration alone: every row starts
-- false until a Super Admin switches it on.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_edit_latest_status" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_schedule_tasks" BOOLEAN NOT NULL DEFAULT false;
