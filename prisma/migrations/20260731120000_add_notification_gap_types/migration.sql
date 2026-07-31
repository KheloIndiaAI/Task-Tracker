-- Two notification types for events that previously produced no notification:
--   * comment_on_my_task     — a plain comment on a task you own or collaborate on
--                              (previously only @mentions notified anyone)
--   * timeline_file_due_soon — a Timeline File you are marked to is nearing its
--                              deadline (the due-notifications cron only covered
--                              task deadlines before)
--
-- Neither value is used in this migration, so adding both in one transaction is
-- safe on PG12+. IF NOT EXISTS keeps it re-runnable against a drifted database.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'comment_on_my_task';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'timeline_file_due_soon';
