import { cn } from '@/lib/utils';

/**
 * Pill — the universal compact label.
 * See docs/COMPONENTS.md §1 and Design Tokens §3.
 *
 * Every pill carries an icon. Colour is never the only signal.
 */

export type PillStatusTone =
  | 'not_started'
  | 'in_progress'
  | 'awaiting_input'
  | 'on_hold'
  | 'completed'
  | 'pending_action'
  | 'awaiting_reply'
  | 'closed';

export type PillPriorityTone = 'low' | 'medium' | 'high' | 'urgent';

export type PillJsLane = 'today' | 'week' | 'month' | 'fortnight';

type CommonProps = {
  className?: string;
};

type StatusPillProps = CommonProps & {
  variant: 'status';
  tone: PillStatusTone;
  label: string;
};

type PriorityPillProps = CommonProps & {
  variant: 'priority';
  tone: PillPriorityTone;
  label: string;
};

type JsPillProps = CommonProps & {
  variant: 'js';
  lane: PillJsLane;
};

type DeadlinePillProps = CommonProps & {
  variant: 'deadline';
  daysLeft: number;
  overdue?: boolean;
};

type MilestonePillProps = CommonProps & {
  variant: 'milestone';
};

export type PillProps =
  | StatusPillProps
  | PriorityPillProps
  | JsPillProps
  | DeadlinePillProps
  | MilestonePillProps;

const STATUS_ICON: Record<PillStatusTone, string> = {
  not_started: 'ti-circle-dashed',
  in_progress: 'ti-progress',
  awaiting_input: 'ti-clock',
  on_hold: 'ti-player-pause',
  completed: 'ti-circle-check',
  pending_action: 'ti-circle-dashed',
  awaiting_reply: 'ti-clock',
  closed: 'ti-circle-check',
};

const STATUS_CLASSES: Record<PillStatusTone, string> = {
  not_started: 'bg-pending-soft text-pending',
  pending_action: 'bg-pending-soft text-pending',
  in_progress: 'bg-info-soft text-info',
  awaiting_input: 'bg-hold-soft text-hold',
  awaiting_reply: 'bg-hold-soft text-hold',
  on_hold: 'bg-hold-soft text-hold',
  completed: 'bg-success-soft text-success',
  closed: 'bg-success-soft text-success',
};

const PRIORITY_ICON: Record<PillPriorityTone, string> = {
  low: 'ti-circle',
  medium: 'ti-arrow-up',
  // Flame is reserved for Urgent so the strongest signal stays unique.
  high: 'ti-chevron-up',
  urgent: 'ti-flame',
};

const PRIORITY_CLASSES: Record<PillPriorityTone, string> = {
  low: 'bg-low-soft text-low',
  medium: 'bg-medium-soft text-medium',
  high: 'bg-high-soft text-high',
  urgent: 'bg-urgent-soft text-urgent',
};

const JS_LABEL: Record<PillJsLane, string> = {
  today: 'JS — today',
  week: 'JS — this week',
  month: 'JS — this month',
  fortnight: 'JS — fortnight',
};

const PILL_BASE =
  'inline-flex items-center gap-1 px-2 py-[3px] text-[10px] font-medium rounded-pill tracking-pill border border-transparent';

export function Pill(props: PillProps) {
  if (props.variant === 'status') {
    return (
      <span className={cn(PILL_BASE, STATUS_CLASSES[props.tone], props.className)}>
        <i className={cn('ti', STATUS_ICON[props.tone], 'text-[11px]')} aria-hidden="true" />
        {props.label}
      </span>
    );
  }

  if (props.variant === 'priority') {
    return (
      <span className={cn(PILL_BASE, PRIORITY_CLASSES[props.tone], props.className)}>
        <i className={cn('ti', PRIORITY_ICON[props.tone], 'text-[11px]')} aria-hidden="true" />
        {props.label}
      </span>
    );
  }

  if (props.variant === 'js') {
    return (
      <span
        className={cn(
          PILL_BASE,
          'bg-accent-soft text-accent border-accent-line',
          props.className,
        )}
      >
        <i className="ti ti-bookmark-filled text-[9px]" aria-hidden="true" />
        {JS_LABEL[props.lane]}
      </span>
    );
  }

  if (props.variant === 'milestone') {
    // Indigo, in its sanctioned "structure" role — the documented Milestone pill.
    return (
      <span
        className={cn(
          PILL_BASE,
          'bg-primary-soft text-primary border-primary-line/40',
          props.className,
        )}
      >
        <i className="ti ti-flag-3 text-[9px]" aria-hidden="true" />
        Milestone
      </span>
    );
  }

  // deadline
  const { daysLeft, overdue } = props;
  const label =
    overdue || daysLeft < 0
      ? `${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? 'day' : 'days'} overdue`
      : daysLeft === 0
        ? 'Today'
        : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
  return (
    <span
      className={cn(
        PILL_BASE,
        overdue || daysLeft < 0
          ? 'bg-urgent-soft text-urgent border-urgent/30'
          : 'bg-accent-soft text-accent border-accent-line',
        props.className,
      )}
    >
      <i className="ti ti-clock text-[11px]" aria-hidden="true" />
      {label}
    </span>
  );
}
