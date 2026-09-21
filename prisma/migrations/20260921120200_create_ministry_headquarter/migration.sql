-- One-time structural migration, by explicit admin request: create the
-- "Ministry Headquarter" organization and place the entire existing ministry
-- structure inside it.
--
-- WHAT MOVES: exactly one column on exactly one set of rows —
-- `divisions.parent_id` on every row with kind = 'division' and no parent
-- (today's top-level divisions: HMYAS Office, Khelo India Scheme, Office of
-- JS, Khelo India, NSDF, SGM, Media & IT, Autonomous Bodies, and any other
-- top-level division that exists on the day this runs).
--
-- WHAT DOES NOT MOVE — and why nothing can be misaligned:
--   * Tasks reference `division_id`, which is unchanged. Every task stays on
--     exactly the division it is on now; ref numbers (`abbreviation`,
--     `task_seq`) are unchanged.
--   * Users reference `division_id` / `sub_division_id` / `section_id` /
--     `pmu_id` — all unchanged.
--   * Sub-divisions and sections hang off their division by `parent_id`, which
--     is unchanged for them (only kind = 'division' rows are updated).
--   * PMUs hang off their division by `pmu_parent_division_id` (falling back
--     to `parent_id`) — unchanged, and never matched by the kind filter.
--   * Timeline-file marks, delegations, heads, notice boards, colours and
--     display order all key on the division's own id — unchanged.
--
-- The organization is created with NO head. Super Admins head every
-- organization by role; anyone else is made an organization head explicitly
-- from Super Admin -> Users. So no user gains or loses any power here.
--
-- `id` has no database default (Prisma generates uuids client-side), so it is
-- supplied with gen_random_uuid() — built into PostgreSQL 13+ (production is
-- RDS PostgreSQL 16). Every other column not listed has a database default.
-- Colour is the indigo "structure" signal (CLAUDE.md, two-accent rule).
--
-- Idempotent: the INSERT is skipped if the organization already exists, and
-- the UPDATE only touches divisions that still have no parent.

INSERT INTO "divisions" ("id", "name", "kind", "abbreviation", "avatar_colour", "display_order")
SELECT gen_random_uuid(), 'Ministry Headquarter', 'organization', '', '#1e1b4b', 0
WHERE NOT EXISTS (
  SELECT 1 FROM "divisions"
  WHERE "kind" = 'organization' AND "name" = 'Ministry Headquarter'
);

UPDATE "divisions"
SET "parent_id" = (
  SELECT "id" FROM "divisions"
  WHERE "kind" = 'organization' AND "name" = 'Ministry Headquarter'
  ORDER BY "created_at" ASC
  LIMIT 1
)
WHERE "kind" = 'division'
  AND "parent_id" IS NULL;
