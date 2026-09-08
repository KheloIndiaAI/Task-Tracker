-- Rename the JS Priority Board's fourth lane from "watchlist" to "fortnight",
-- so the tasks list can offer a Daily / Weekly / Fortnight / Monthly bucket set
-- (D W F M pills) without introducing a fifth lane the board would have to grow.
--
-- ALTER TYPE ... RENAME VALUE is metadata-only in PostgreSQL: no table rewrite,
-- no data migration, existing rows keep pointing at the same enum member. It
-- also keeps the member's position, so ORDER BY js_priority_lane is unchanged.
--
-- Guarded so it is safe to re-run and on a database that already carries the
-- new name from `db push` drift.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'JsPriorityLane' AND e.enumlabel = 'watchlist'
  ) THEN
    ALTER TYPE "JsPriorityLane" RENAME VALUE 'watchlist' TO 'fortnight';
  END IF;
END
$$;

-- Historical audit rows keep the word they were written with: task_activity and
-- notification payloads store the lane as free JSON (e.g. {"to":"watchlist"}),
-- and those records describe what was true at the time. describeNotification
-- falls back to the raw value, so an old entry still reads sensibly.
