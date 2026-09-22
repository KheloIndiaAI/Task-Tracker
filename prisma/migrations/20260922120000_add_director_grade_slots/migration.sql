-- Two hierarchy slots for Sports Authority of India officers:
--
--   regional_director   — rank level 3, alongside Director.
--   assistant_director  — rank level 5, alongside Under Secretary.
--
-- By product decision both carry exactly the Director's slot powers, in the
-- divisions they are a member of (isDirectorGrade in
-- src/lib/hierarchy-slots.ts). Ranking is driven by HIERARCHY_SLOT_LEVEL in
-- src/lib/labels.ts, not the enum's internal order, so a plain append is
-- correct — the same reasoning as 20260713130000_add_hierarchy_slots.
--
-- Neither value is used in this migration, so adding both in one transaction
-- is safe on PG12+. No row changes: nobody holds either slot until a Super
-- Admin assigns it. IF NOT EXISTS makes a re-run a no-op.
ALTER TYPE "HierarchySlot" ADD VALUE IF NOT EXISTS 'regional_director';
ALTER TYPE "HierarchySlot" ADD VALUE IF NOT EXISTS 'assistant_director';
