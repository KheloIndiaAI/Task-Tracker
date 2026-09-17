/**
 * Pure PMU-team rules — no database import, so they are unit-testable in
 * isolation. The DB-backed helpers live in `src/lib/pmu-team.ts`.
 */

/**
 * Whether a task being CREATED is shared with a PMU team
 * (`tasks.shared_with_pmu_team`).
 *
 * One flag, two directions, decided by the board the task lands on:
 *
 *   - **A PMU's own board** — shared by DEFAULT. Work put on a PMU's board is
 *     the team's work, so every member should have it in their assigned list
 *     from the moment it exists rather than waiting for the team leader to flip
 *     a switch after the fact. An explicit off is still honoured.
 *   - **A division's board** — off unless asked for, and only when the division
 *     actually has a PMU under it. Showing a division task down to a PMU is the
 *     one deliberate hole in PMU isolation, so it is opted into, never assumed;
 *     and with no PMU beneath it there is no audience to share with, so the
 *     flag would be meaningless.
 *
 * `requested` is tri-state on purpose. `undefined` means no switch was shown at
 * all — a Timeline-File spawn, a bulk import — which is NOT the same as the
 * user turning it off. Only the PMU branch distinguishes the two, and only
 * there does it matter.
 */
export function resolvePmuTeamShareOnCreate(input: {
  /** The target board is a PMU's own (Division.kind === 'pmu'). */
  targetIsPmu: boolean;
  /** The target division has at least one PMU under it. Ignored for a PMU target. */
  divisionHasPmu: boolean;
  /** What the form asked for; `undefined` when it offered no switch. */
  requested: boolean | undefined;
}): boolean {
  if (input.targetIsPmu) return input.requested ?? true;
  return input.requested === true && input.divisionHasPmu;
}
