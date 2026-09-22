# Data Model

> Expansion of PRD §6. All entities, fields, enums, relationships, and indexes for the MYAS Task Tracker. Targets self-hosted Postgres, accessed via Prisma. Auth via NextAuth Credentials provider + JWT sessions — passwords live on the `users` table here, no separate auth schema. Field types are Postgres types; `uuid` is `gen_random_uuid()` unless noted.

---

## 1. Enums

Define these as Postgres `CREATE TYPE … AS ENUM(…)` so values are validated at the database layer.

### 1.1 `hierarchy_slot`
Permission-bearing ladder. Slot governs what a user can see; designation is the human-readable title.

```
'js' | 'osd' | 'director' | 'deputy_secretary' | 'under_secretary' | 'section_officer' | 'aso'
```

Mapping to level number (used in inspector "Level N of 7"):

| Slot | Level |
|---|---|
| `js` | 1 |
| `osd` | 2 |
| `director` | 3 |
| `deputy_secretary` | 4 |
| `under_secretary` | 5 |
| `section_officer` | 6 |
| `aso` | 7 |

### 1.2 `contract_role`
Optional override on a user. The hierarchy slot still governs permissions; the contract role is the visible designation badge.

```
null | 'po' | 'apo' | 'yp'
```

(`po` = Project Officer, `apo` = Assistant Project Officer, `yp` = Young Professional.)

### 1.3 `pmu_role`
Used only when `users.is_pmu = true`.

```
'pmu_senior_leadership' | 'pmu_team_leader' | 'pmu_senior_consultant' | 'pmu_consultant' | 'pmu_intern'
```

### 1.4 `task_status`
Super Admin can extend this list at runtime via the Tags & labels sub-section (Phase 3). The seed set:

```
'not_started' | 'in_progress' | 'awaiting_input' | 'on_hold' | 'completed'
```

### 1.5 `task_priority`
```
'low' | 'medium' | 'high' | 'urgent'
```

### 1.6 `js_priority_lane`
```
null | 'today' | 'week' | 'month' | 'watchlist'
```

A non-null value means the task carries a JS Priority badge that propagates everywhere the task appears.

### 1.7 `visibility`
```
'personal' | 'division'
```

`personal` is creator-only — not visible even to superiors. `division` follows hierarchy rules. Setting `division` at creation, or toggling visibility either way afterwards, is a head power (Super Admin, OSD, the division's head, or an active delegate); everyone else creates `personal` tasks only. See PERMISSIONS.md §5.11.

### 1.8 `recurrence_rule`
Super Admin can extend this list at runtime. Seed set:

```
null | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_yearly'
```

### 1.9 `task_collaborator_role`
```
'collaborator' | 'division_lead' | 'co_owner'
```

`division_lead` — one per participating division on a cross-division task; acts as collaborator with division-level accountability.
`co_owner` — equal accountability with the primary owner; max 3 per task.

### 1.10 `timeline_file_status`
Distinct from `task_status` — Timeline Files have their own list.

```
'pending_action' | 'in_progress' | 'awaiting_reply' | 'on_hold' | 'closed'
```

### 1.11 `attachment_owner_type`
```
'task' | 'task_comment' | 'timeline_file' | 'timeline_file_source' | 'timeline_file_action' | 'js_engagement'
```

### 1.12 `attachment_source`
```
'uploaded' | 'drive_link'
```

### 1.13 `notification_type`
```
'task_assigned'
| 'mention'
| 'status_changed_on_my_task'
| 'js_priority_added'
| 'task_due_soon'
| 'task_overdue'
| 'timeline_file_marked_to_division'
| 'secretary_comment_on_timeline_file'
| 'cross_division_status_change'
| 'reassignment_approval_requested'
| 'reassignment_approved'
| 'reassignment_rejected'
| 'password_reset_by_admin'
| 'task_transferred'
```

### 1.14 `audit_action`
```
'create' | 'update' | 'delete' | 'archive' | 'restore' | 'login' | 'logout' | 'password_reset' | 'role_change' | 'hierarchy_change'
```

---

## 2. Entities

### 2.1 `users`

The app owns this table outright — no separate auth schema. NextAuth's Credentials provider verifies against `password_hash` here, and JWT sessions mean no database session table is needed.

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | `gen_random_uuid()` |
| `name` | `text` | NOT NULL | Display name |
| `username` | `text` | NOT NULL, UNIQUE | Sign-in identifier. Rendered in JetBrains Mono in the inspector |
| `email` | `text` | UNIQUE | Optional. Internal admin contact, not used for login or password reset (v1 has no email flows) |
| `password_hash` | `text` | NOT NULL | Argon2id (preferred) or bcrypt. Hashed in app code before insert. Never returned to the client |
| `designation` | `text` | NOT NULL | UI label, e.g. "Young Professional (SO slot)" |
| `hierarchy_slot` | `hierarchy_slot` | NOT NULL | Governs permissions |
| `contract_role` | `contract_role` |  | Visual override; nullable |
| `division_id` | `uuid` | FK → `divisions.id`, NOT NULL | The single **home** division — drives ownership, display, PMU home, and reference-number identity. JS/OSD use the "Office of JS" division. Extra (admin-granted) memberships live in `user_division_access` (§2.3), not here |
| `sub_division_id` | `uuid` | FK → `divisions.id` |  Optional; must have `parent_id = users.division_id` |
| `section_id` | `uuid` | FK → `divisions.id` | Optional; must have `parent_id = users.sub_division_id` |
| `is_pmu` | `boolean` | NOT NULL, default false | PMU member flag |
| `pmu_role` | `pmu_role` |  | Required when `is_pmu = true` |
| `supervisor_id` | `uuid` | FK → `users.id` | Direct supervisor; null for JS or unassigned officers |
| `is_active` | `boolean` | NOT NULL, default true | Disabled users keep audit history; sign-in blocked when false (checked in the NextAuth `authorize` callback) |
| `is_super_admin` | `boolean` | NOT NULL, default false | Same person as OSD initially |
| `is_organization_head` | `boolean` | NOT NULL, default false | "Organization head" toggle (Super Admin → Users). Head of the organization the home division sits in, with head powers over every division beneath it. See [PERMISSIONS.md §5.20](PERMISSIONS.md) |
| `force_password_change` | `boolean` | NOT NULL, default false | Set by Super Admin at reset when "Force password change on next login" is ticked. Honoured in the auth callback — blocks any route except the change-password page until cleared |
| `password_changed_at` | `timestamptz` |  | Written on every successful password change; used to invalidate older JWTs by comparing the token's `iat` |
| `last_login` | `timestamptz` |  | Written on successful sign-in by the NextAuth `signIn` event |
| `created_by` | `uuid` | FK → `users.id` | The Super Admin who created this user; null for the bootstrap account |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |

**NextAuth Account / Session / VerificationToken tables:** not needed. Credentials provider + `strategy: 'jwt'` keeps sessions stateless on the client; the JWT carries `userId`, `hierarchy_slot`, `is_super_admin`, `division_id`, and the issued-at timestamp. Server reads from `users` on every privileged action.

**Check constraints:**
- `(is_pmu = true) ⇒ pmu_role IS NOT NULL`
- `(contract_role IS NOT NULL) ⇒ hierarchy_slot IS NOT NULL` (contract role overlays a slot)

---

### 2.2 `divisions`

A single `divisions` table holds divisions, sub-divisions, sections, and PMUs — distinguished by `parent_id` and the `kind` enum-equivalent boolean flags.

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `name` | `text` | NOT NULL | "Khelo India Mission", "NADA", "KIM PMU", etc. |
| `parent_id` | `uuid` | FK → `divisions.id` | NULL only for an organization; otherwise points up the tree (a division's parent is an organization or a directorate) |
| `kind` | `DivisionKind` | NOT NULL | Postgres enum, in tree order: `organization`, `directorate`, `division`, `sub_division`, `section`, `pmu`. Only `division` and `pmu` rows carry tasks. See [PERMISSIONS.md §5.20](PERMISSIONS.md) |
| `has_pmu` | `boolean` | NOT NULL, default false | Only meaningful when `kind = 'division'`. PMU itself sits as a sibling with `kind = 'pmu'` and the same `parent_id` |
| `pmu_parent_division_id` | `uuid` | FK → `divisions.id` | Only set when `kind = 'pmu'` — the ministry division this PMU supports |
| `avatar_colour` | `text` | NOT NULL | Hex string; assigned at creation, stable thereafter. See [COLOUR_TOKENS.css](COLOUR_TOKENS.css) §1.4 for seed values |
| `display_order` | `integer` | NOT NULL, default 0 | For sidebar ordering and drag-and-drop reordering |
| `created_by` | `uuid` | FK → `users.id` |  |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |

**Check constraints:**
- `(parent_id IS NULL) ⇒ kind = 'organization'` (enforced in `createDivisionAction`, not the database; from 2026-09-21 — before that, top-level rows were divisions)
- `(kind = 'pmu') ⇒ pmu_parent_division_id IS NOT NULL`
- `(kind = 'pmu') ⇒ has_pmu = false`

---

### 2.3 `user_division_access`

Admin-granted **extra** division memberships for a user. A user's home division stays on `users.division_id` (§2.1); each row here adds one more division the user is a full member of. The member set = home division + these rows. Granted and revoked by a Super Admin in **Super Admin → Users** (the "Additional divisions" checkbox list). See [PERMISSIONS.md §5.18](PERMISSIONS.md).

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | `gen_random_uuid()` |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL | ON DELETE NO ACTION — rows are cleaned up explicitly in `deleteUserAction` before the user is removed |
| `division_id` | `uuid` | FK → `divisions.id`, NOT NULL | ON DELETE CASCADE — the grant disappears with the division |
| `granted_by` | `uuid` | FK → `users.id` | Nullable; ON DELETE NO ACTION. The Super Admin who created the grant; null when seeded by migration |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |

**Unique constraint:** `(user_id, division_id)` — a user is granted a given division at most once. The home division is never inserted here.

**Indexes:**
- `CREATE INDEX user_division_access_user_id_idx ON user_division_access (user_id);` — "extra divisions for this user" (member-set resolution)
- `CREATE INDEX user_division_access_division_id_idx ON user_division_access (division_id);` — "extra members of this division"

Replaces the retired hardcoded cross-division links (`CROSS_DIVISION_ALLOCATION_LINKS`, `CROSS_DIVISION_PARTICIPANT_LINKS`, `CROSS_DIVISION_VIEW_GRANTS`); cross-division reach is now per-user data here rather than code.

---

### 2.4 `tasks`

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `name` | `text` | NOT NULL | Required; the only field needed for Quick Create |
| `description` | `text` |  | Free text; supports inline attachments via the comments / attachments tables |
| `owner_id` | `uuid` | FK → `users.id`, NOT NULL | Single primary owner. Defaults to creator |
| `division_id` | `uuid` | FK → `divisions.id`, NOT NULL | Primary division. For cross-division tasks, secondary divisions appear via `task_collaborators.role = 'division_lead'` |
| `status` | `task_status` | NOT NULL, default `'not_started'` |  |
| `priority` | `task_priority` | NOT NULL, default `'low'` |  |
| `js_priority_lane` | `js_priority_lane` |  | NULL when not on the board |
| `visibility` | `visibility` | NOT NULL, default `'division'` | Toggle on creation; editable later |
| `due_date` | `timestamptz` |  | Optional; includes time-of-day when set |
| `milestone` | `boolean` | NOT NULL, default false | Controls appearance in Milestone Calendar (Phase 3) |
| `recurrence_rule` | `recurrence_rule` |  | NULL = one-time |
| `parent_task_id` | `uuid` | FK → `tasks.id` | When set, this row is a subtask of the parent |
| `linked_timeline_file_id` | `uuid` | FK → `timeline_files.id` | Optional, single TF link |
| `created_by` | `uuid` | FK → `users.id`, NOT NULL |  |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | Touch on any field change; shown as "Last edited" |
| `last_activity_at` | `timestamptz` | NOT NULL, default `now()` | Last *meaningful* activity (comment, subtask, attachment, tag, owner/status/priority/context change); powers the "Recently modified" list sort. Never advanced by passive reads (`task_read` / `subtask_read`). Maintained via `src/lib/activity.ts`. Indexed. |
| `archived_at` | `timestamptz` |  | NULL = active; non-null = archived (soft-delete) |
| `archived_by` | `uuid` | FK → `users.id` |  |

**Subtasks:** Each subtask is a full task row (own owner, due date, status, comments, attachments) with `parent_task_id` set. The PRD calls these "full subtasks" intentionally — the schema does not collapse them into a string field.

**Check constraints:**
- `(parent_task_id IS NOT NULL) ⇒ visibility = (SELECT visibility FROM tasks WHERE id = parent_task_id)` — subtasks inherit visibility from parent (enforce via trigger)

---

### 2.5 `task_collaborators`

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `task_id` | `uuid` | FK → `tasks.id`, NOT NULL | Cascade delete |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL |  |
| `role` | `task_collaborator_role` | NOT NULL |  |
| `added_by` | `uuid` | FK → `users.id`, NOT NULL |  |
| `added_at` | `timestamptz` | NOT NULL, default `now()` |  |

**Unique constraint:** `(task_id, user_id)` — a user appears at most once on a task's collaborator list. The primary owner sits on `tasks.owner_id`, not here.

**Check constraint:**
- `co_owner` count per task ≤ 3 (enforce via trigger or partial unique index using a count query)

---

### 2.6 `task_comments`

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `task_id` | `uuid` | FK → `tasks.id`, NOT NULL | Cascade delete |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL | Author |
| `body` | `text` | NOT NULL | Plain text with `@Name ` markers for mentions |
| `mentions` | `uuid[]` | NOT NULL, default `'{}'` | Array of mentioned `users.id` — populated server-side from `body` |
| `status_transition` | `task_status` |  | Optional. Set when a status change is performed alongside this comment; renders as the inline status-update card |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |
| `edited_at` | `timestamptz` |  |  |

A status transition tied to a comment is the canonical "request status / deliver status" flow. There is no separate `status_requests` table.

---

### 2.7 `task_activity`

Per-task user-facing event log (visible in the Activity section on the task detail screen). Distinct from `audit_log` — this is for users, not Super Admin.

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `task_id` | `uuid` | FK → `tasks.id`, NOT NULL | Cascade delete |
| `actor_id` | `uuid` | FK → `users.id`, NOT NULL |  |
| `event_type` | `text` | NOT NULL | `status_changed`, `js_priority_changed`, `owner_reassigned`, `milestone_toggled`, `collaborator_added`, `collaborator_removed`, `timeline_file_linked`, `timeline_file_unlinked`, `attachment_uploaded`, `subtask_added`, `subtask_completed`, `subtask_updated`, `task_created`, `task_transferred` |
| `payload` | `jsonb` | NOT NULL, default `'{}'` | Event-specific data (old/new values, names for legibility) |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |

---

### 2.8 `attachments`

Polymorphic — attaches to tasks, comments, Timeline Files, Timeline File source documents, and Timeline File action documents via `owner_type` + `owner_id`.

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `owner_type` | `attachment_owner_type` | NOT NULL |  |
| `owner_id` | `uuid` | NOT NULL | FK is logical, not declared (polymorphism); enforced via trigger or app code |
| `file_name` | `text` | NOT NULL | Display name |
| `file_url` | `text` | NOT NULL | S3 object key (relative path inside the configured bucket) for `source = 'uploaded'`, or the external URL for `source = 'drive_link'`. Resolve to a signed URL at read time |
| `mime_type` | `text` |  |  |
| `size_bytes` | `bigint` |  |  |
| `source` | `attachment_source` | NOT NULL |  |
| `uploaded_by` | `uuid` | FK → `users.id`, NOT NULL |  |
| `uploaded_at` | `timestamptz` | NOT NULL, default `now()` |  |

---

### 2.9 `timeline_files`

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `ref_no` | `text` | NOT NULL, UNIQUE | Format `TF-YYYY/NNN`, auto-generated. NNN resets annually (1, 2, 3, …) |
| `ref_year` | `integer` | NOT NULL | Indexable; used by the counter trigger to compute the next NNN |
| `ref_seq` | `integer` | NOT NULL | The NNN portion |
| `subject` | `text` | NOT NULL |  |
| `from_whom` | `text` | NOT NULL | Free text — "Prime Minister's Office", a Minister, another ministry, an external party |
| `received_date` | `date` | NOT NULL | Date the correspondence was received |
| `deadline_date` | `date` |  | Optional; either entered directly or computed from "duration in days" + `received_date` (UI does the conversion, schema stores the date) |
| `status` | `timeline_file_status` | NOT NULL, default `'pending_action'` | Always manually set — never derived from child tasks |
| `secretary_comments` | `text` |  | Rendered as a serif quote callout |
| `action_document_attachment_id` | `uuid` | FK → `attachments.id` | NULL until uploaded; the placeholder UI shows when null |
| `created_by` | `uuid` | FK → `users.id`, NOT NULL | OSD or a staff member delegated by OSD |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |
| `last_activity_at` | `timestamptz` | NOT NULL, default `now()` | Last *meaningful* activity (status/field change, comment, marked-to change, linked task, document upload); powers the "Recently modified" list sort. Timeline files have no `updated_at`, so this is their sole "last touched" signal. Maintained via `src/lib/activity.ts`. Indexed. |
| `archived_at` | `timestamptz` |  |  |
| `archived_by` | `uuid` | FK → `users.id` |  |

**Unique constraint:** `(ref_year, ref_seq)` — backs the annual counter.

---

### 2.10 `timeline_file_marked_to`

Many-to-many between a Timeline File and divisions it is marked to (visibility scope).

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `timeline_file_id` | `uuid` | FK → `timeline_files.id`, NOT NULL | Cascade delete |
| `division_id` | `uuid` | FK → `divisions.id`, NOT NULL |  |
| `marked_at` | `timestamptz` | NOT NULL, default `now()` |  |

**Primary key:** `(timeline_file_id, division_id)`.

A Timeline File is visible only to divisions in this table (plus OSD/JS via the master view).

---

### 2.11 `timeline_file_task_links`

One-way spawning relationship from a Timeline File to a task. A task can link to at most one Timeline File via `tasks.linked_timeline_file_id`; this table provides the reverse-lookup surface used by the linked-tasks panel.

> **Note:** Because `tasks.linked_timeline_file_id` already captures the link, this table is technically redundant. Keep it as a denormalised index for the "all child tasks with current statuses" panel — it sidesteps a full `tasks` scan when many TFs and tasks coexist. Maintain via trigger when `tasks.linked_timeline_file_id` changes.

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `timeline_file_id` | `uuid` | FK → `timeline_files.id`, NOT NULL | Cascade delete |
| `task_id` | `uuid` | FK → `tasks.id`, NOT NULL | Cascade delete |
| `linked_at` | `timestamptz` | NOT NULL, default `now()` |  |
| `linked_by` | `uuid` | FK → `users.id`, NOT NULL |  |

**Primary key:** `(timeline_file_id, task_id)`.

---

### 2.12 `timeline_file_activity`

Same shape as `task_activity`; per-Timeline-File user-facing event log.

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `timeline_file_id` | `uuid` | FK → `timeline_files.id`, NOT NULL | Cascade delete |
| `actor_id` | `uuid` | FK → `users.id`, NOT NULL |  |
| `event_type` | `text` | NOT NULL | `created_from_correspondence`, `marked_to_division`, `marked_to_division_removed`, `secretary_comment_added`, `task_linked`, `task_unlinked`, `status_changed`, `action_document_uploaded`, `source_document_added`, `forwarded_to_division` |
| `payload` | `jsonb` | NOT NULL, default `'{}'` |  |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |

---

### 2.13 `tags`

Super Admin-managed list. Phase 3 surface, but the table can exist in Phase 1 for foreign keys.

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `name` | `text` | NOT NULL, UNIQUE |  |
| `created_by` | `uuid` | FK → `users.id`, NOT NULL |  |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |

### 2.14 `task_tags`

| Field | Type | Constraint |
|---|---|---|
| `task_id` | `uuid` | FK → `tasks.id`, NOT NULL, cascade delete |
| `tag_id` | `uuid` | FK → `tags.id`, NOT NULL |

Primary key: `(task_id, tag_id)`.

---

### 2.15 `notifications`

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL | Recipient |
| `type` | `notification_type` | NOT NULL |  |
| `payload` | `jsonb` | NOT NULL, default `'{}'` | `task_id`, `timeline_file_id`, `actor_id`, etc. |
| `read_at` | `timestamptz` |  | NULL = unread |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |

In-app bell only in v1.

---

### 2.16 `reassignment_requests`

Sideways or upward reassignments require the superior's tap-approval. Downward reassignments within own chain do not pass through this table — they apply immediately and only emit a `task_activity` row.

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `task_id` | `uuid` | FK → `tasks.id`, NOT NULL |  |
| `requested_by` | `uuid` | FK → `users.id`, NOT NULL |  |
| `proposed_owner_id` | `uuid` | FK → `users.id`, NOT NULL |  |
| `approver_id` | `uuid` | FK → `users.id`, NOT NULL | The superior whose approval is needed |
| `status` | `text` | CHECK in `('pending','approved','rejected','withdrawn')`, NOT NULL, default `'pending'` |  |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |
| `resolved_at` | `timestamptz` |  |  |

---

### 2.17 `audit_log`

System-wide, immutable. The Super Admin sub-section reads from this table. Distinct from the per-task and per-file activity logs.

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `actor_id` | `uuid` | FK → `users.id` | Null only for system-generated events |
| `entity_type` | `text` | NOT NULL | `task`, `timeline_file`, `user`, `division`, `tag`, `attachment` |
| `entity_id` | `uuid` | NOT NULL |  |
| `action` | `audit_action` | NOT NULL |  |
| `before` | `jsonb` | NOT NULL, default `'{}'` | Snapshot before the change |
| `after` | `jsonb` | NOT NULL, default `'{}'` | Snapshot after the change |
| `ip` | `inet` |  | Captured on login events |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |  |

**Insert-only.** No update or delete from the app; revoke those permissions at the DB level.

---

## 3. Relationships (text diagram)

```
users
    ├── supervisor_id → users (self-FK, hierarchy chain)
    ├── division_id → divisions
    ├── sub_division_id → divisions
    └── section_id → divisions

divisions
    ├── parent_id → divisions (self-FK; division → sub-division → section)
    ├── pmu_parent_division_id → divisions (PMU's ministry division)
    └── created_by → users

user_division_access
    ├── user_id → users (extra member; ON DELETE NO ACTION)
    ├── division_id → divisions (granted division; ON DELETE CASCADE)
    └── granted_by → users (Super Admin who granted; nullable)

tasks
    ├── owner_id → users
    ├── division_id → divisions
    ├── parent_task_id → tasks (self-FK; subtask relationship)
    ├── linked_timeline_file_id → timeline_files
    ├── created_by → users
    └── archived_by → users
        ├── 1:M ── task_collaborators ── M:1 ── users
        ├── 1:M ── task_comments ── M:1 ── users
        ├── 1:M ── task_activity ── M:1 ── users
        ├── 1:M ── attachments (owner_type='task')
        ├── 1:M ── task_tags ── M:1 ── tags
        └── 1:M ── reassignment_requests

timeline_files
    ├── created_by → users
    ├── archived_by → users
    └── action_document_attachment_id → attachments
        ├── 1:M ── timeline_file_marked_to ── M:1 ── divisions
        ├── 1:M ── timeline_file_task_links ── M:1 ── tasks
        ├── 1:M ── timeline_file_activity ── M:1 ── users
        └── 1:M ── attachments (owner_type='timeline_file_source' or 'timeline_file_action')

notifications ── M:1 ── users
audit_log ── M:1 ── users
```

---

## 4. Index recommendations

Optimised for the dominant read patterns: "tasks I own", "tasks in my division", "tasks at status X", and "Timeline Files marked to my division" — all of which run on every screen.

### `tasks`
- `CREATE INDEX tasks_owner_id_idx ON tasks (owner_id) WHERE archived_at IS NULL;`
- `CREATE INDEX tasks_division_id_idx ON tasks (division_id) WHERE archived_at IS NULL;`
- `CREATE INDEX tasks_status_idx ON tasks (status) WHERE archived_at IS NULL;`
- `CREATE INDEX tasks_js_priority_lane_idx ON tasks (js_priority_lane) WHERE js_priority_lane IS NOT NULL AND archived_at IS NULL;` — JS Priority Board read
- `CREATE INDEX tasks_due_date_idx ON tasks (due_date) WHERE due_date IS NOT NULL AND archived_at IS NULL;` — overdue / due-today queries
- `CREATE INDEX tasks_parent_task_id_idx ON tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;` — subtask listing
- `CREATE INDEX tasks_linked_timeline_file_id_idx ON tasks (linked_timeline_file_id) WHERE linked_timeline_file_id IS NOT NULL;`
- `CREATE INDEX tasks_milestone_idx ON tasks (due_date) WHERE milestone = true AND archived_at IS NULL;` — Milestone Calendar (Phase 3)

### `task_collaborators`
- `CREATE INDEX task_collaborators_user_id_idx ON task_collaborators (user_id);` — "tasks where I'm a collaborator"
- (Already covered by the `(task_id, user_id)` unique for the reverse lookup.)

### `task_comments`
- `CREATE INDEX task_comments_task_id_created_at_idx ON task_comments (task_id, created_at DESC);` — thread render
- `CREATE INDEX task_comments_mentions_gin_idx ON task_comments USING GIN (mentions);` — "tasks where I was mentioned"

### `task_activity`
- `CREATE INDEX task_activity_task_id_created_at_idx ON task_activity (task_id, created_at DESC);`

### `timeline_files`
- `CREATE UNIQUE INDEX timeline_files_ref_no_idx ON timeline_files (ref_no);` (already implied by UNIQUE)
- `CREATE INDEX timeline_files_deadline_date_idx ON timeline_files (deadline_date) WHERE deadline_date IS NOT NULL AND archived_at IS NULL;`
- `CREATE INDEX timeline_files_status_idx ON timeline_files (status) WHERE archived_at IS NULL;`
- `CREATE INDEX timeline_files_received_date_idx ON timeline_files (received_date DESC);`

### `timeline_file_marked_to`
- `CREATE INDEX tf_marked_to_division_id_idx ON timeline_file_marked_to (division_id);` — "Timeline Files visible to my division"

### `timeline_file_task_links`
- `CREATE INDEX tf_task_links_timeline_file_id_idx ON timeline_file_task_links (timeline_file_id);`
- `CREATE INDEX tf_task_links_task_id_idx ON timeline_file_task_links (task_id);`

### `notifications`
- `CREATE INDEX notifications_user_id_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;` — bell badge count
- `CREATE INDEX notifications_user_id_idx ON notifications (user_id, created_at DESC);` — full panel

### `audit_log`
- `CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);`
- `CREATE INDEX audit_log_actor_id_idx ON audit_log (actor_id, created_at DESC);`
- `CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);` — date-range filter

### `users`
- `CREATE INDEX users_supervisor_id_idx ON users (supervisor_id);` — chain traversal
- `CREATE INDEX users_division_id_idx ON users (division_id);`
- `CREATE INDEX users_hierarchy_slot_idx ON users (hierarchy_slot);`

### `divisions`
- `CREATE INDEX divisions_parent_id_idx ON divisions (parent_id);` — tree traversal
- `CREATE INDEX divisions_kind_idx ON divisions (kind);`

---

## 5. Auth model — quick reference

| Concern | How |
|---|---|
| Password hashing | Argon2id in app code (`@node-rs/argon2` or `argon2`), bcrypt acceptable fallback. Never store plaintext, never log it |
| Credential check | NextAuth Credentials provider `authorize()` callback queries `users` by `username`, verifies hash, returns the row only if `is_active = true` |
| Session | JWT, `strategy: 'jwt'`. Token carries `userId`, `hierarchy_slot`, `is_super_admin`, `division_id`, `iat`. No DB session table |
| Token invalidation | Compare token `iat` against `users.password_changed_at`. Older → reject in middleware |
| Force password change | `users.force_password_change = true` → middleware redirects every request except `/profile/change-password` and `/api/auth/*` |
| User creation | Super Admin POSTs to a server action that hashes the initial password and inserts into `users`. NextAuth is not involved in creation |
| Password reset | Super Admin sets a new hash on the row and optionally flips `force_password_change` |
| Row-level access control | Enforced in app code (the data layer), not Postgres RLS. Every read goes through a helper that filters by the caller's `hierarchy_slot` / chain / division / PMU flag — see [PERMISSIONS.md](PERMISSIONS.md) |
| Bootstrap | A one-off Prisma seed script (`prisma/seed.ts`) inserts the first Super Admin. After that, Super Admin creates all other users from the console |

---

## 6. JS Engagements (`js_engagements`)

Office of JS meetings shown on the planning calendar (`/calendar`). Seeing and managing them is limited to Office-of-JS members and Super Admins — see [PERMISSIONS.md §5.12](PERMISSIONS.md).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | required |
| `starts_at` | timestamptz | date + start time as one IST-wall-clock instant (stored UTC) |
| `venue` | text? | free text: venue or meeting link |
| `mom_notes` | text? | minutes of meeting |
| `division_id` | uuid FK → `divisions` | always the seeded `Office of JS` division |
| `created_by` | uuid FK → `users` | |
| `created_at` / `updated_at` / `archived_at` | timestamptz | soft-archive via `archived_at` |

- `js_engagement_participants (engagement_id, user_id)` — join to `users`, cascades on engagement delete.
- Attachments reuse the polymorphic `attachments` table with `owner_type = 'js_engagement'` (added to `AttachmentOwnerType`).
- Indexes: `starts_at`, `division_id`, and `(user_id)` on the participants table.
