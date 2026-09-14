import { formatDateIST, formatTimeIST, istDayDiff, istTimeInput } from '@/lib/date';

/**
 * Word count for a free-text field with a word cap (e.g. a task's Latest
 * status). Splits on any run of whitespace after trimming, so a
 * whitespace-only string counts as zero words rather than one. Shared by the
 * client component's live counter and the server action's validation, so the
 * two can never disagree about what counts as a word.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Word cap for a task's Latest status field — see SectionLatestStatus. */
export const MAX_LATEST_STATUS_WORDS = 50;

/**
 * Word cap for a division's Notice board field — see DivisionNoticeBoard.
 * Deliberately the same number as MAX_LATEST_STATUS_WORDS (same UX, by
 * request) but kept as its own named constant for clarity at the call site.
 */
export const MAX_DIVISION_NOTICE_WORDS = 50;

/**
 * Initials extractor.
 *   "Ravi Kumar"  → "RK"
 *   "OSD"         → "OS"
 *   "Aditya N."   → "AN"
 *   "Karan V."    → "KV"
 */
export function initialsOf(name: string): string {
  const cleaned = name.trim().replace(/[().]/g, '');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const first = parts[0][0] ?? '';
  const last = parts[parts.length - 1][0] ?? '';
  return (first + last).toUpperCase();
}

/**
 * Due-date formatter for task cards.
 * Sentence case, no exclamation marks.
 */
export type DueTone = 'today' | 'overdue' | 'soon' | 'future' | 'none';

export type DueDisplay = { label: string; tone: DueTone };

export function formatDue(due: Date | null | undefined, now: Date = new Date()): DueDisplay {
  if (!due) return { label: 'No due date', tone: 'none' };

  // Everything is computed in IST explicitly, so a card rendered on the
  // server (UTC) and the detail rendered in the browser show the same day
  // and the same clock time — e.g. a 4 pm IST deadline reads "4:00 pm",
  // never the underlying 10:30 UTC.
  const diff = istDayDiff(due, now);
  const hasTime = istTimeInput(due) !== '00:00';
  const timeSuffix = hasTime ? `, ${formatTimeIST(due)}` : '';

  if (diff < 0) {
    const abs = Math.abs(diff);
    return { label: `Overdue ${abs} d`, tone: 'overdue' };
  }
  if (diff === 0) return { label: `Today${timeSuffix}`, tone: 'today' };
  if (diff === 1) return { label: `Tomorrow${timeSuffix}`, tone: 'soon' };

  // Within the next 7 days → "Mon, 9 Jun"; further out → "9 Jun".
  if (diff <= 7) {
    return { label: `${formatDateIST(due, true)}${timeSuffix}`, tone: 'soon' };
  }
  return { label: `${formatDateIST(due)}${timeSuffix}`, tone: 'future' };
}

/**
 * Deadline countdown for Timeline File pills.
 */
export function daysUntil(date: Date, now: Date = new Date()): number {
  // IST calendar days, so a deadline near midnight counts the Indian day.
  return istDayDiff(date, now);
}

/**
 * IST offset — the app is India-only (Asia/Kolkata, UTC+05:30).
 */
export const IST_UTC_OFFSET = '+05:30';

/** Default time-of-day for a due date entered without a time: 4 pm IST. */
export const DEFAULT_DUE_TIME = '16:00';

/**
 * Parse a due-date form value into a Date.
 *
 * A date-only value (`YYYY-MM-DD`, from an `<input type="date">`) carries no
 * time. Left to `new Date()` it is read as 00:00 UTC, which renders as
 * 05:30 IST — so we default it to 16:00 IST (4 pm) instead. Values that
 * already include a time (`YYYY-MM-DDTHH:mm`, from a datetime-local input)
 * are interpreted in IST as entered. Anything already carrying a timezone or
 * seconds is passed straight to `new Date()`.
 */
export function parseDueDateInput(value: string): Date {
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(`${s}T${DEFAULT_DUE_TIME}:00${IST_UTC_OFFSET}`);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) {
    return new Date(`${s}:00${IST_UTC_OFFSET}`);
  }
  return new Date(s);
}
