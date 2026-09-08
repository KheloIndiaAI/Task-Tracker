-- An @mention now grants sight of the task it was made on, so every task read
-- asks "was I mentioned in this task's discussion?" (the base clauses in
-- buildVisibilityClausesFrom). task_comments.mentions is a uuid[]; without a
-- GIN index that containment test is a sequential scan of every comment, on a
-- path that runs for the tasks list, search, the calendar and each task page.
--
-- CONCURRENTLY is deliberately NOT used: Prisma wraps a migration in a
-- transaction, and CREATE INDEX CONCURRENTLY cannot run inside one. The table
-- is small at this ministry's scale, so the brief write lock is acceptable; on
-- a much larger table this would want to be run by hand outside the migration.
CREATE INDEX IF NOT EXISTS "task_comments_mentions_idx"
  ON "task_comments" USING GIN ("mentions");
