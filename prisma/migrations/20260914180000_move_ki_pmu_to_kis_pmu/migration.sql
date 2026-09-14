-- One-time data migration, by explicit admin request: move every member and
-- every task currently on KI_PMU (a PMU team under the "Khelo India"
-- division) onto the existing KIS_PMU team under "Khelo India Scheme".
-- KIS_PMU's own pre-existing members/tasks are untouched — this only adds
-- KI_PMU's to them.
--
-- KI_PMU itself is deliberately left in place, now empty, under Khelo
-- India — not deleted here. The Super Admin can remove it from Structure &
-- hierarchy once the move is confirmed correct; that UI's existing delete
-- action already refuses to remove a division that still has users or
-- children, so leaving the row costs nothing and keeps a safety net.
--
-- A PMU member's home division always matches their PMU's own resolved
-- parent (pmu_parent_division_id, falling back to parent_id — see
-- getPmuDivisionIdsFor and the admin user actions' placement rule), so
-- every moved user's division_id is updated to KIS_PMU's parent alongside
-- their pmu_id. pmu_role, sub_division_id and section_id are untouched —
-- role carries over regardless of team, and PMU members already sit
-- outside the sub-division/section ladder (both already null for them).
--
-- Every task whose division_id is KI_PMU's moves to KIS_PMU's id, personal
-- and division-visibility alike — division_id is required on every task
-- regardless of visibility, and a task's own ref_number is a historical,
-- immutable label (not globally unique, not regenerated here — see the
-- column's own comment in schema.prisma).
--
-- Timeline Files have no division_id of their own — a file reaches a
-- division by being "marked to" it (timeline_file_marked_to, a many-to-many
-- join, composite PK [timeline_file_id, division_id]). Any file marked to
-- KI_PMU is re-marked to KIS_PMU the same way; a file already marked to
-- BOTH (the rare case) would collide on that composite PK, so those are
-- left on KIS_PMU and the now-redundant KI_PMU mark is dropped instead of
-- updated. Document Centre records and Business Cards are NOT touched —
-- neither model carries a division/PMU association at all in this schema,
-- so there is nothing on them to move.
--
-- Guarded to be a safe no-op on re-run: if either PMU can't be found by
-- name, or KIS_PMU has no resolvable parent, it skips instead of failing;
-- and once KI_PMU is empty, running this again simply matches zero rows.
DO $$
DECLARE
  ki_pmu_id UUID;
  kis_pmu_id UUID;
  kis_pmu_home_division_id UUID;
  moved_users INT;
  moved_tasks INT;
  moved_tf_marks INT;
  dropped_duplicate_tf_marks INT;
BEGIN
  SELECT id INTO ki_pmu_id FROM divisions WHERE kind = 'pmu' AND name = 'KI_PMU' LIMIT 1;
  SELECT id INTO kis_pmu_id FROM divisions WHERE kind = 'pmu' AND name = 'KIS_PMU' LIMIT 1;

  IF ki_pmu_id IS NULL OR kis_pmu_id IS NULL THEN
    RAISE NOTICE 'Skipping KI_PMU -> KIS_PMU move: one or both PMU teams not found (KI_PMU=%, KIS_PMU=%)', ki_pmu_id, kis_pmu_id;
    RETURN;
  END IF;

  SELECT COALESCE(pmu_parent_division_id, parent_id) INTO kis_pmu_home_division_id
    FROM divisions WHERE id = kis_pmu_id;

  IF kis_pmu_home_division_id IS NULL THEN
    RAISE NOTICE 'Skipping KI_PMU -> KIS_PMU move: KIS_PMU (%) has no resolvable parent division', kis_pmu_id;
    RETURN;
  END IF;

  UPDATE users
     SET pmu_id = kis_pmu_id,
         division_id = kis_pmu_home_division_id
   WHERE pmu_id = ki_pmu_id;
  GET DIAGNOSTICS moved_users = ROW_COUNT;

  UPDATE tasks
     SET division_id = kis_pmu_id
   WHERE division_id = ki_pmu_id;
  GET DIAGNOSTICS moved_tasks = ROW_COUNT;

  -- Re-mark timeline files: flip KI_PMU -> KIS_PMU unless the file is
  -- already marked to KIS_PMU too (would collide on the composite PK).
  UPDATE timeline_file_marked_to tfmt
     SET division_id = kis_pmu_id
   WHERE tfmt.division_id = ki_pmu_id
     AND NOT EXISTS (
       SELECT 1 FROM timeline_file_marked_to other
        WHERE other.timeline_file_id = tfmt.timeline_file_id
          AND other.division_id = kis_pmu_id
     );
  GET DIAGNOSTICS moved_tf_marks = ROW_COUNT;

  -- Anything still marked to KI_PMU at this point was already marked to
  -- KIS_PMU as well — that KI_PMU mark is now redundant, not lost data.
  DELETE FROM timeline_file_marked_to WHERE division_id = ki_pmu_id;
  GET DIAGNOSTICS dropped_duplicate_tf_marks = ROW_COUNT;

  IF moved_users > 0 OR moved_tasks > 0 OR moved_tf_marks > 0 OR dropped_duplicate_tf_marks > 0 THEN
    INSERT INTO audit_log (id, actor_id, entity_type, entity_id, action, before, after)
    VALUES (
      gen_random_uuid(),
      NULL, -- system-triggered migration, no signed-in admin to attribute to
      'division',
      kis_pmu_id,
      'hierarchy_change',
      jsonb_build_object('sourcePmuId', ki_pmu_id, 'sourcePmuName', 'KI_PMU'),
      jsonb_build_object(
        'mergedIntoPmuId', kis_pmu_id,
        'mergedIntoPmuName', 'KIS_PMU',
        'movedUsers', moved_users,
        'movedTasks', moved_tasks,
        'movedTimelineFileMarks', moved_tf_marks,
        'droppedDuplicateTimelineFileMarks', dropped_duplicate_tf_marks,
        'migration', '20260914180000_move_ki_pmu_to_kis_pmu'
      )
    );
  END IF;

  RAISE NOTICE 'Moved % user(s), % task(s), and % timeline-file mark(s) (% duplicate mark(s) dropped) from KI_PMU (%) to KIS_PMU (%)',
    moved_users, moved_tasks, moved_tf_marks, dropped_duplicate_tf_marks, ki_pmu_id, kis_pmu_id;
END
$$;
