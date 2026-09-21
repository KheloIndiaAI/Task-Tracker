-- Two new levels ABOVE a division in Structure & hierarchy:
--
--   organization — the new root. "Ministry Headquarter" holds the existing
--                  ministry structure (created in 20260921120200); each
--                  Regional Centre becomes another organization.
--   directorate  — an optional middle layer, headed by an Assistant Director,
--                  between an organization and its divisions.
--
-- Added BEFORE 'division' so the enum's sort order is the tree's order from
-- the root down (organization, directorate, division, sub_division, section,
-- pmu) — several queries order by `kind asc`, and listing a tree top-down is
-- the natural reading. schema.prisma declares them in the same order.
--
-- Neither value is USED in this migration, so adding both in one transaction
-- is safe on PG12+ (same reasoning as 20260713130000_add_hierarchy_slots).
-- The first use is in 20260921120200, a separate migration and therefore a
-- separate transaction — PostgreSQL refuses a newly added enum value inside
-- the transaction that added it. IF NOT EXISTS makes a re-run a no-op.
ALTER TYPE "DivisionKind" ADD VALUE IF NOT EXISTS 'organization' BEFORE 'division';
ALTER TYPE "DivisionKind" ADD VALUE IF NOT EXISTS 'directorate' BEFORE 'division';
