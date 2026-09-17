-- Remove the per-task privacy setting.
--
-- Every task now belongs to a division and is readable by everyone who reads
-- that board. Dropping `tasks.visibility` is what makes the previously
-- 'personal' tasks readable by their division — they are NOT deleted, moved or
-- altered in any other way; only the column that hid them goes.
--
-- `users.can_see_personal_tasks` was the Super-Admin-managed grant to peer
-- through that setting. With nothing left to peer through it goes too.
--
-- Irreversible by design: once the column is gone the old per-task choice is
-- not recoverable, which is the intended end state.

ALTER TABLE "tasks" DROP COLUMN "visibility";

ALTER TABLE "users" DROP COLUMN "can_see_personal_tasks";

DROP TYPE "Visibility";
