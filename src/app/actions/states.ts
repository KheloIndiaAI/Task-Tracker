/**
 * Shared state types + initial values for server actions.
 *
 * Lives outside any 'use server' file so non-async exports are legal.
 * Action files import from here; consumer client components import from
 * here for the type and INITIAL_* constants, and from the action file
 * for the async function itself.
 *
 *   // Server action file
 *   'use server'
 *   import type { CreateTaskState } from './states'
 *   export async function createTaskAction(...): Promise<CreateTaskState> {...}
 *
 *   // Consumer
 *   import { createTaskAction } from '@/app/actions/tasks'
 *   import { INITIAL_CREATE_STATE, type CreateTaskState } from '@/app/actions/states'
 */

// ------------------------------------------------------------
// Base shape
// ------------------------------------------------------------

type Base = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Counter so identical successive results are observable in useEffect. */
  epoch?: number;
};

const ZERO: Base = { ok: false, epoch: 0 };

// ------------------------------------------------------------
// Login (src/app/(auth)/login/actions.ts)
// ------------------------------------------------------------

export type LoginState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<'username' | 'password', string>>;
};

export const INITIAL_LOGIN_STATE: LoginState = { ok: false };

// ------------------------------------------------------------
// Tasks (src/app/actions/tasks.ts)
// ------------------------------------------------------------

export type CreateTaskState = Base & { taskId?: string };
export const INITIAL_CREATE_STATE: CreateTaskState = { ...ZERO };

export type UpdateStatusState = Base;
export const INITIAL_STATUS_STATE: UpdateStatusState = { ...ZERO };

export type UpdatePriorityState = Base;
export const INITIAL_PRIORITY_STATE: UpdatePriorityState = { ...ZERO };

export type UpdateFieldsState = Base;
export const INITIAL_FIELDS_STATE: UpdateFieldsState = { ...ZERO };

export type SetJsPriorityLaneState = Base;
export const INITIAL_JS_LANE_STATE: SetJsPriorityLaneState = { ...ZERO };

// Generic action state for actions without a special return field.
export type GenericActionState = Base;
export const INITIAL_GENERIC_STATE: GenericActionState = { ...ZERO };

// ------------------------------------------------------------
// Profile (src/app/actions/profile.ts)
// ------------------------------------------------------------

export type ChangePasswordState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<
    Record<'currentPassword' | 'newPassword' | 'confirmPassword', string>
  >;
  epoch?: number;
};
export const INITIAL_CHANGE_PASSWORD_STATE: ChangePasswordState = {
  ok: false,
  epoch: 0,
};

// ------------------------------------------------------------
// Admin users (src/app/actions/admin-users.ts)
// ------------------------------------------------------------

export type AdminUserState = Base & { userId?: string };
export const INITIAL_ADMIN_USER_STATE: AdminUserState = { ...ZERO };

// ------------------------------------------------------------
// Admin structure (src/app/actions/admin-structure.ts)
// ------------------------------------------------------------

export type AdminStructureState = Base & { id?: string };
export const INITIAL_STRUCTURE_STATE: AdminStructureState = { ...ZERO };

// ------------------------------------------------------------
// Timeline Files (src/app/actions/timeline-files.ts)
// ------------------------------------------------------------

export type TimelineFileState = Base & { id?: string; refNo?: string };
export const INITIAL_TF_STATE: TimelineFileState = { ...ZERO };

// ------------------------------------------------------------
// Document Centre (src/app/actions/documents.ts)
// ------------------------------------------------------------

export type CreateDocumentState = Base & { documentId?: string };
export const INITIAL_CREATE_DOCUMENT_STATE: CreateDocumentState = { ...ZERO };

// -----------------------------------------------------------------------------
// Business Cards (src/app/actions/business-cards.ts)
// -----------------------------------------------------------------------------

export type BusinessCardState = Base & { businessCardId?: string };
export const INITIAL_BUSINESS_CARD_STATE: BusinessCardState = { ...ZERO };

// ------------------------------------------------------------
// Division access delegations (src/app/actions/delegations.ts)
// ------------------------------------------------------------

export type DelegationState = Base;
export const INITIAL_DELEGATION_STATE: DelegationState = { ...ZERO };

// ------------------------------------------------------------
// JS Engagements (src/app/actions/engagements.ts)
// ------------------------------------------------------------

export type EngagementState = Base & { engagementId?: string };
export const INITIAL_ENGAGEMENT_STATE: EngagementState = { ...ZERO };

/** Full engagement returned by the detail read (used by the detail sheet). */
export type EngagementDetailData = {
  id: string;
  title: string;
  startsAt: string; // ISO — serialised across the RSC/action boundary
  venue: string | null;
  momNotes: string | null;
  createdBy: { id: string; name: string };
  participants: { id: string; name: string }[];
  attachments: { id: string; fileName: string; fileUrl: string }[];
};
