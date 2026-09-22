/**
 * Human-readable labels for enum values used across the app.
 * Keep this file as the single source for sentence-case copy of system
 * values so all screens read identically.
 */

export const HIERARCHY_SLOT_LABEL: Record<string, string> = {
  hmyas: 'HMYAS',
  js: 'Joint Secretary',
  osd: 'Officer on Special Duty',
  director: 'Director',
  regional_director: 'Regional Director',
  deputy_secretary: 'Deputy Secretary',
  under_secretary: 'Under Secretary',
  assistant_director: 'Assistant Director',
  section_officer: 'Section Officer',
  aso: 'Assistant Section Officer',
  consultant: 'Consultant',
};

/**
 * Rank of each slot (lower = higher up). `hmyas` is the apex at level 0;
 * the officer ladder is 1–7. `consultant` is deliberately absent — it is an
 * unranked support role, so consumers render it without a level badge
 * (guard with `!= null`, since the apex is a falsy 0).
 *
 * Levels may be shared: the Sports Authority of India grades sit alongside
 * their ministry equivalents — Regional Director with Director (3), Assistant
 * Director with Under Secretary (5). Rank only; powers are separate (see
 * isDirectorGrade in hierarchy-slots.ts).
 */
export const HIERARCHY_SLOT_LEVEL: Record<string, number> = {
  hmyas: 0,
  js: 1,
  osd: 2,
  director: 3,
  regional_director: 3,
  deputy_secretary: 4,
  under_secretary: 5,
  assistant_director: 5,
  section_officer: 6,
  aso: 7,
};

export const CONTRACT_ROLE_LABEL: Record<string, string> = {
  po: 'Project Officer',
  apo: 'Assistant Project Officer',
  yp: 'Young Professional',
};

export const PMU_ROLE_LABEL: Record<string, string> = {
  pmu_senior_leadership: 'Senior Leadership',
  pmu_team_leader: 'Team Leader',
  pmu_senior_consultant: 'Senior Consultant',
  pmu_consultant: 'Consultant',
  pmu_intern: 'Intern',
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  awaiting_input: 'Awaiting input',
  on_hold: 'On hold',
  completed: 'Completed',
};

export const TASK_PRIORITY_LABEL: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const RECURRENCE_LABEL: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
};
