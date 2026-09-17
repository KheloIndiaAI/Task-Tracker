# Permissions Matrix

> **2026-09-17 — the personal/division split is gone.** `tasks.visibility`, the `users.can_see_personal_tasks` grant and the Visibility control were removed (migration `20260917120000_remove_task_visibility`). Every task belongs to a division and is readable by everyone who reads that board; no task was deleted or moved. Creating a task is no longer a head power — anyone creates on a board they belong to, and a PMU member creates on their own PMU. Passages below that still describe personal-visibility tasks, the `can_see_personal_tasks` grant, or `canCreateDivisionTask` are stale and superseded by this note.


> Division-wide by default: every non-PMU ministry officer sees all division-visibility tasks in each division they are a member of, from first login, regardless of hierarchy slot. A user's **member set** is their home division (`users.division_id`) plus any extra divisions a Super Admin has granted them via `user_division_access` (§5.18); in every member division the user is an ordinary member and sees that division's board. Special rules layer on top for PMU isolation, personal visibility, cross-division tasks, headed-division access (delegations), and OSD's unrestricted access. Enforcement lives in the data-access layer (`buildVisibilityClausesFrom` in src/lib/visibility-rules.ts) — every read filters by the caller's member set / PMU flag / headed divisions before returning rows. This document is the source of truth for what those helpers must implement.

---

## 1. Roles in the system

| Role | Hierarchy slot | Notes |
|---|---|---|
| Joint Secretary | `js` | Top of the chain. Sees own tasks + the OSD-curated JS Priority Board |
| Officer on Special Duty | `osd` | Sees everything in the ministry. Toggles into Super Admin |
| Director | `director` | Sees full division (sub-divisions, sections, subordinates) |
| Deputy Secretary | `deputy_secretary` | Sees own chain |
| Under Secretary | `under_secretary` | Sees own chain |
| Section Officer | `section_officer` | Sees section + everyone under |
| Assistant Section Officer | `aso` | Sees own tasks; no subordinates by definition |
| PMU member | (any PMU role) | Sees only PMU-tagged tasks in their division |
| Super Admin | (overlay) | Same person as OSD initially; unrestricted access to any page |

Contract roles (PO / APO / YP) are visual overlays on a hierarchy slot. **Permissions follow the slot, not the contract role.**

---

## 2. Matrix — Tasks

Each row is a permission. Each column is a role acting on a task they can see (either by ownership, collaboration, hierarchy, or PMU collaboration).

| | JS | OSD | Director | Dy. Sec | Under Sec | Section Officer | ASO | PMU member | Super Admin |
|---|---|---|---|---|---|---|---|---|---|
| **See own tasks** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **See member divisions — all division-visibility tasks**⁵ |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | PMU team only⁴ | ✓ |
| **See headed divisions (head or delegate)** |  | ✓ | if head³ | if head³ | if head³ | if head³ |  |  | ✓ |
| **See other divisions** |  | ✓ |  |  |  |  |  |  | ✓ |
| **See JS Priority Board** | ✓ | ✓ | partial² | partial² | partial² | partial² | partial² |  | ✓ |
| **See Personal-visibility tasks of others** |  |  |  |  |  |  |  |  | ✓ (audit only) |
| **Create task (personal visibility)** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (in own division, will be PMU-tagged) | ✓ |
| **Create division-level task** | head³ | ✓ | head³ | head³ | head³ | head³ | head³ | head³ | ✓ |
| **Work a task they own** (status, priority, description, subtasks) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Redefine a task** (name, due date, milestone, recurrence) — see §5.13 | ✓ | ✓ | own div | head³ | head³ | head³ | head³ | head³ | ✓ |
| **Edit any task they can see** |  | ✓ |  |  |  |  |  |  | ✓ |
| **Comment / @mention on tasks they can see** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Change status on task they own / collaborate on** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Reassign owner from the Owner row** | head³ | ✓ | head³ | head³ | head³ | head³ | head³ | head³ | ✓ |
| **Approve reassignment requests** | for own subordinates | for own subordinates | for own subordinates | for own subordinates | for own subordinates | for own subordinates |  |  | ✓ (any) |
| **Transfer task to same-division user (with comment)** | own | own | own | own | own | own | own | own | own |
| **Add collaborators** | ✓ (own/visible) | ✓ | ✓ (own/visible) | ✓ (own/visible) | ✓ (own/visible) | ✓ (own/visible) | ✓ (own) | ✓ (PMU-tagged) | ✓ |
| **Add cross-division collaborators (division leads)** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |
| **Set JS Priority lane** |  | ✓ |  |  |  |  |  |  | ✓ |
| **Toggle milestone** | own | ✓ | own | own | own | own | own | own | ✓ |
| **Toggle visibility** | head³ | ✓ | head³ | head³ | head³ | head³ | head³ | head³ | ✓ |
| **Delete task (hard-delete)** — own personal always; division task see §5.13 | head³ | head³ | head³ | head³ | head³ | head³ | head³ | head³ | ✓ (any) |

¹ "Needs approval" = the request is created; the proposed new owner's superior must tap-approve before the reassignment takes effect.
² "partial" = only sees tasks owned by self or own subordinates that happen to be on the board, plus the visible-to-them JS Priority badge on every task they can already see. The full board is OSD + JS + Super Admin.

³ "head" = only when the user is that division's head (`divisions.head_user_id`) or holds an active `division_access_delegations` row for it — the hierarchy slot itself grants nothing. Giving tasks on a division's board is a head power; everyone else creates personal tasks (see §5.11).

⁴ PMU members see only their PMU team's division-visibility tasks (`ownerId IN <pmu team>`), never the full division board. See §5.2.

⁵ "member divisions" = the user's **home division** (`users.division_id`) plus any extra divisions a Super Admin has granted via `user_division_access`. The user sees the full division board of every division in this set and acts as an ordinary member there — the same rights they hold in their home division, but no head powers. See §5.18.

---

## 3. Matrix — Timeline Files

Timeline Files are visible only to divisions they are marked to, plus OSD/JS via the master view. An officer sees a Timeline File marked to **any** of their member divisions (home or admin-granted — §5.18): the scoper's `markedTo` clause unions the caller's full member set, so an extra membership widens Timeline-File sight the same way it widens task sight.

**Barred slots.** The **PMU Consultant** hierarchy slot (`consultant`) is excluded from the Timeline Files module entirely — it sees no Timeline File in any list, detail, count, calendar deadline, search result, or attachment, regardless of marked-to division, and the Timeline Files nav link is hidden for it. Enforced by `canAccessTimelineFiles` (`src/lib/timeline-files-access.ts`), which `buildTfVisibilityClause` checks first (a match-nothing clause that no role grant can widen); the linked-Timeline-File card on a task is gated by the same rule. Add more barred slots in `TIMELINE_FILES_HIDDEN_SLOTS`.

| | JS | OSD | Director of marked division | Other officers of marked division | Officers of unmarked divisions | PMU member of marked division | Super Admin |
|---|---|---|---|---|---|---|---|
| **See Timeline File** | ✓ (master) | ✓ (master) | ✓ | ✓ (per their chain) |  |  | ✓ |
| **Create Timeline File** |  | ✓ (or delegate) |  |  |  |  | ✓ |
| **Edit subject / from / received date / deadline / marked-to** |  | ✓ | ✓ |  |  |  | ✓ |
| **Change status** |  | ✓ | ✓ |  |  |  | ✓ |
| **Add / edit Secretary's comments** |  | ✓ |  |  |  |  | ✓ |
| **Upload source documents** |  | ✓ | ✓ |  |  |  | ✓ |
| **Upload action document** |  | ✓ | ✓ | ✓ (officer of section taking action) |  |  | ✓ |
| **Spawn task from Timeline File ("Create task from this file")** | head³ | ✓ | head³ | head³ |  |  | ✓ |
| **Forward to division / change marked-to** |  | ✓ |  |  |  |  | ✓ |
| **Share link (read-only)** | ✓ | ✓ | ✓ |  |  |  | ✓ |
| **Hard-delete** |  |  |  |  |  |  | ✓ |

Timeline File status is **always manually set** — never auto-derived from linked task statuses.

---

## 4. Matrix — Super Admin Console

| Sub-section | OSD | Super Admin | Anyone else |
|---|---|---|---|
| Structure & hierarchy | (toggle into Super Admin) | ✓ |  |
| Users | (toggle into Super Admin) | ✓ |  |
| Tags & labels (Phase 3) | (toggle into Super Admin) | ✓ |  |
| Audit trail (Phase 3) | (toggle into Super Admin) | ✓ |  |
| Bulk import (Phase 4) | (toggle into Super Admin) | ✓ |  |
| Settings (Phase 4) | (toggle into Super Admin) | ✓ |  |

The role switcher in the top bar is the only entry point. OSD and Super Admin are the same person initially; the switcher just flips the surface. The capability is gated by `users.is_super_admin = true`.

---

## 5. Special rules

### 5.1 Personal visibility

- `visibility = 'personal'` makes the task visible to **exactly three sets of people, and no one else**: the **creator** (e.g. a Division Head or Super Admin who set it Personal and assigned it out), the **assigned owner**, and users **explicitly added as collaborators**. It is invisible to everyone else — other division members, and division heads / OSD / Super Admins who are none of the above — including in lists, dashboards, search, the calendar, and every task view.
- Enforced by the three base clauses in `buildVisibilityClausesFrom` (`ownerId` / `collaborators` / `createdById + visibility:'personal'`); every role clause is gated on `visibility:'division'`, so no role ever matches a Personal task. Dashboards (Command Centre, JS Dashboard) restrict their ministry-wide aggregates to `visibility:'division'` so a Personal task cannot leak into a count or list there either.
- Super Admin / OSD do **not** see others' Personal tasks in the regular lists — only via the audit trail (for compliance).
- The task appears in the **Personal Tasks** list of each eligible viewer. Subtasks inherit visibility from the parent task — a subtask cannot be more permissive than its parent.

### 5.2 PMU isolation

- A PMU is a sibling row in `divisions` with `kind = 'pmu'` and `pmu_parent_division_id` pointing to its supporting ministry division. PMU membership is `users.pmu_id`; everyone sharing a `pmu_id` is one PMU team.
- **A PMU team member sees their PMU team's tasks and nothing else of the division**: division-visibility tasks owned by anyone in their PMU (themselves + teammates), plus any task they own or are a collaborator on. They **never see the division board** — the internal ministry tasks are invisible to them.
- Enforced in the scoper (`buildVisibilityClausesFrom`, src/lib/visibility-rules.ts): the PMU branch emits an owner-scoped clause `{ visibility: 'division', ownerId: { in: <pmu member ids> } }` instead of the division-wide clause. Teammate ids come from `getPmuTeammateIds` (src/lib/visibility.ts). Personal tasks of teammates stay private (the clause is gated on `visibility: 'division'`).
- The reverse is permitted: ministry officers in a division see their PMU's tasks freely (the PMU members' tasks live in the division, so a division user's board already includes them).
- A PMU member holding an active delegation additionally sees the delegated division for the window, on top of their PMU team's tasks.
- On the `/tasks` board a PMU member's second segment is labelled "Other tasks of my PMU team" rather than "…of my division".
- **Division task shown to the PMU team**: a division's head (direct or an active delegate; OSD / Super Admin too) can flip **"Show this task to PMU team"** on a task of their own division, setting the same `tasks.shared_with_pmu_team = true`. The scoper then adds `{ visibility: 'division', shared_with_pmu_team: true, divisionId: <the caller's PMU's parent division> }` for every PMU member, so they see that one task and nothing else from the division's board — the single, per-task hole in PMU isolation, opened only by the person who runs that board. Those members are already **participants** of the parent division (their home division is it, per the Users form's "PMU must belong to the chosen division" rule), so they can comment, be added as collaborators, be assigned subtasks and be @mentioned on it with no further grant. The switch is shown only when the division actually has a PMU under it, and refused server-side otherwise (`canSharePmuTeam`). Settable at creation (Quick Create) and any time after, from the task's Collaborators section. Ownership alone is NOT enough — widening who sees the board is a head power.
- **PMU team (entire) share**: the PMU's Team Leader can share a task they own with the whole PMU team. It sets `tasks.shared_with_pmu_team = true` (a PMU task only), and the scoper adds a **live** clause `{ visibility: 'division', shared_with_pmu_team: true, divisionId: <caller's pmu_id> }` — so every current member sees it, including anyone who joins the PMU later. Managed from the task's Collaborators section by the owning Team Leader (OSD / Super Admin may also toggle it); enforced server-side in `setPmuTeamShareAction`. A shared task is lifted into each member's **"Tasks assigned to me"** segment (`segmentTasksByRelation`, /tasks), and members are notified on enable. **Excluded: the PMU's home-division head** (`divisions.head_user_id` of `pmu_parent_division_id`) — they still see the task via the owner-scoped clause but it is not treated as a whole-team share for them (no share clause, not lifted into "assigned", no notification). The share is cleared automatically if the task's division changes away from the PMU.

### 5.3 Cross-division tasks

- Single **primary owner** (one person, the `tasks.owner_id`).
- One **division lead** per participating division, added via `task_collaborators.role = 'division_lead'`.
- The task appears in every participating division's list with a **"Primary: [Division Name]"** badge.
- All division leads notified at creation and at every status change.
- Division leads may comment and edit the task as collaborators; they cannot change ownership.
- **Participant scope (`src/lib/task-participants.ts`)**: collaborators, subtask assignees, and @mentions are drawn from — and validated against — the task's **participants**: the active **members** of the task's division (or, for a PMU task, its team), that division's **head**, and the oversight roles **OSD + Super Admin**. "Member of the task's division" means the division is the user's home division **or** they hold a `user_division_access` grant for it (§5.18) — resolved by a `{ divisionAccess: { some: { divisionId } } }` clause folded into the participant query, so an admin-granted member of the division counts as a participant everywhere. The seeded **Office of JS** division is the exception — its tasks may involve any active user. Because only oversight roles and the head otherwise cross division boundaries, adding a collaborator from an *unrelated* division is not possible for ordinary users; cross-division reach comes from shared membership (a user granted the task's division via `user_division_access`) or from OSD / Super Admin / the head. Every task user-picker and its server-side guard (`addCollaboratorAction`, `addSubtaskAction`, `updateSubtaskAction`, `resolveMentions`) call the same helper, so they never diverge. The task **owner** is deliberately stricter (same division only — set at creation).

### 5.4 OSD unrestricted access

- OSD sees everything across all divisions — the Command Centre.
- OSD can edit any task they can see (the only non-Super-Admin role with this power).
- OSD adds, removes, and reorders JS Priority lanes (exclusive control).
- OSD is the default creator of Timeline Files.

### 5.5 JS view

- JS's home is the JS Priority Board (Today + This Week visible by default; This Month + Watchlist via swipe).
- JS sees their own tasks plus everything on the Priority Board.
- JS does not see division-internal tasks unless they appear on the Priority Board or list them as owner/collaborator.

### 5.6 Reassignment

- **Who can reassign from the Owner row** — only **Super Admin, OSD, or the head of the task's division** (direct head or active delegate). The Owner row is read-only for everyone else, including the task's own owner and creator: a normal user changes ownership through **Transfer task** (below), not the Owner row. Enforced in `reassignTaskAction` (`mayInitiate`) and mirrored by `canReassign` on the task page.
- **Downward within own chain** — applies immediately. Log to `task_activity` and `audit_log`. No notification to the previous owner beyond the activity log entry.
- **Sideways or upward** — creates a `reassignment_requests` row with `approver_id` = the proposed new owner's superior. The superior receives a notification of type `reassignment_approval_requested`. On approval, the reassignment applies and a `reassignment_approved` notification fires to the requester; on rejection, `reassignment_rejected` fires.
- **Same-division transfer (by current owner)** — the task owner can transfer ownership to any active user in the same division without approval, and **must supply a comment** explaining the hand-off (the sheet offers one-tap reasons — "On leave", "This work belongs to another official", "Delegating it" — or free text). `ownerId` updates immediately; `createdById` stays unchanged. If the task had `personal` visibility, it flips to `division`. Activity log records `task_transferred` with `{from, to}`. The new owner receives `task_assigned`; the original creator (if different from both parties) receives `task_transferred`.
- The reassignment picker UI marks rows that would require approval with an amber "Approval needed" badge. The transfer button is separate — a prominent card visible only to the current task owner.
- **Assign / transfer across divisions flows from shared membership.** A division head (direct head or active delegate) may assign or transfer a task on a division they head to **any member of that division** — home members and users granted the division via `user_division_access` alike, since both are ordinary members of it (§5.18). The picker for a division's task therefore surfaces every member of that division, and an assignment to one of them is free (no approval). Cross-division reach (for example a user working across Khelo India and NSDF) is now expressed by granting that specific user the extra membership, not by a hardcoded division link.
  - **Retired.** The former **Cross-division allocation link (Khelo India → NSDF)** — `CROSS_DIVISION_ALLOCATION_LINKS = {KI:['NSDF']}` and `RbacActor.allocatableDivisionIds` in `src/lib/rbac` — has been **deleted from the code**. It automatically let any Khelo India head create / assign / transfer NSDF tasks. That blanket link no longer applies; a Super Admin instead grants the specific users who need cross-division reach an extra membership via `user_division_access`. (The migration seeds the named users into their extra memberships; see §5.18.)

### 5.7 Deletion and archive

The platform-wide task **Archive** (soft-delete) remains removed — there is no Archive/Restore action for **tasks** (the swipe-to-archive gesture is gone); the `archived_at` / `archived_by` columns and `archivedAt: null` read filters stay in the schema but nothing sets them for tasks.

**Timeline Files** have a **reversible archive** (soft-delete): OSD or a Super Admin may archive a file and later restore it (`archiveTimelineFileAction` / `unarchiveTimelineFileAction`, gated by `requireOsdOrSuperAdmin`). An archived file drops out of the active list, the summary counts, the calendar, and search; it appears only under the **"Archived TL files"** list toggle and on its (read-only) detail page, from which OSD/Super Admin can restore it. Archiving is visibility-neutral — it never changes who can see the file (`buildTfVisibilityClause` is unchanged). Archive/restore events are recorded in the audit trail.

| Condition | Available action | Who |
|---|---|---|
| Task — delete (hard) | **Delete** (removes the task, its subtasks, comments, collaborators, and attachments; cannot be undone) | The **head of the task's division** (direct head or active delegate) or a **Super Admin** (any task); plus a user for their **own personal task**. Enforced by `canActAsHeadOf` in `deleteTaskAction`. |
| Timeline File — archive / restore | **Archive** (reversible soft-delete) / **Restore** | OSD or Super Admin (`requireOsdOrSuperAdmin`) |
| Timeline File — hard-delete | **Delete** (permanent) | Super Admin only (any file, regardless of creator) |
| User | **Disable** (login blocked, audit history preserved) | Super Admin only |
| User — hard-delete |  | Not supported — would break the audit trail |

### 5.8 Status change on subordinate's task

- A superior can change the status of a subordinate's task that they can see.
- The change is logged to `task_activity` with the superior as the actor; the owner receives a `status_changed_on_my_task` notification.

### 5.9 @mention reach

- A user can `@`-mention only the task's **participants** (§5.3) — the division's members/head plus OSD/Super Admin (any user for Office of JS). The mention picker and the server-side `resolveMentions` both apply this rule, so an `@`-name outside the set silently does not resolve (no notification, no access grant).
- Mentioning a user automatically grants them read access to **this specific task** only, even if they would not otherwise see it. They appear as an implicit collaborator until removed.

### 5.10 Bootstrap account

- The first Super Admin account is created by the deployer (out-of-band).
- That account has `is_super_admin = true` and `hierarchy_slot = 'osd'`.
- No other Super Admin can exist until that account creates one and ticks the Super Admin Access toggle in the inspector.

### 5.11 Division-level task creation is a head power

- Only **Super Admin**, **OSD**, a division's **head** (`divisions.head_user_id`), or an **active delegate** (an unrevoked `division_access_delegations` row whose inclusive window covers now) may create a task with `division` visibility in that division. Enforced in `createTaskAction` via `canCreateDivisionTask` (src/lib/rbac/rules.ts).
- **Membership does not grant division-task creation.** Being a member of a division — home or admin-granted via `user_division_access` (§5.18) — lets a non-head see and work that division's board, but not create tasks on it. A non-head member still creates **personal** tasks only; creating a division task stays a head power. Head powers live on `headedDivisionIds`, never on the member set.
- Everyone else creates **personal** tasks only; the Quick Create sheet does not offer the Division option to them and defaults to Personal.
- The same rule gates **changing** a task's visibility in either direction (`updateTaskFieldsAction`) — an owner may not promote a personal task onto the division board, nor hide a division task.
- Spawning a task from a Timeline File always produces a division-level task, so the same rule applies there; the former "any viewer of the file" exception is removed.
- Subtasks still inherit the parent's visibility — an owner breaking down a head-given division task produces division-visible subtasks by design.
- Known residual path: a same-division ownership transfer of a `personal` task still auto-flips it to `division` (§5.6) so it does not vanish from the recipient's view.

### 5.12 JS Engagements (Office of JS meetings on the calendar)

The planning calendar (`/calendar`) shows three item kinds — **JS engagements** (teal), **task deadlines** (dark blue), and **Timeline file deadlines** (red). Tasks and Timeline files reuse their existing visibility scopers (`buildVisibilityClauses`, `buildTfVisibilityClause`), so a division user sees only their division's task deadlines and a PMU member only their team's (§5.2) — calendar and lists stay consistent.

JS Engagements are the Office of JS's own layer:

- **Seeing and managing engagements is limited to Office-of-JS members and Super Admins.** "Office-of-JS member" = `users.division_id` equals the seeded `Office of JS` division. Everyone else does not see engagements on the calendar at all, and cannot create or edit them.
- Both gates are the single predicate `canAccessEngagements` (src/lib/engagements.ts); the server actions (`createEngagementAction` / `updateEngagementAction` / `deleteEngagementAction` / `getEngagementDetail`) re-check it from the DB.
- Fields: title (required), date + start time (required; stored as one `starts_at` instant, IST wall-clock), venue or meeting link (optional), participants (existing active users), MoM notes, and optional attachment links. Attachments reuse the polymorphic `attachments` table (`owner_type = 'js_engagement'`).
- Every engagement is anchored to the Office of JS division, so the caller's own membership is the only visibility gate needed.
- From any date the calendar offers quick actions: **Add JS engagement** (managers only), **Create task** (opens Quick Create pre-dated), and **Create timeline file** (OSD / Super Admin). Clicking a task/TF opens its page; clicking an engagement opens its detail sheet with edit/delete for managers.

### 5.13 Working a task vs redefining it (owner ≠ editor)

Owning a task lets you **work** it, not **redefine** it. This matters after a transfer: the new owner is often a normal user, and simply becoming owner must not hand them control of the task's definition.

- **A normal user (even the owner) cannot**: delete the task, or edit its **name**, **due date**, **milestone**, or **recurrence**. These are gated by `canEditTaskDetails` / the delete guard — Super Admin, OSD, JS, a director of the division, or its head. (A user's **own personal task** stays fully theirs to edit and delete.)
- **The owner (and creator) can still**: change **status** and **priority**, edit the **description**, comment, and manage **subtasks** — including **reassigning a subtask** to someone else.
- **Subtask reassignment is logged with full detail**: `updateSubtaskAction` records a `subtask_updated` activity event carrying the subtask, the previous and new assignee (`fromName` / `toName`), and the actor; the activity log renders it as "‹actor› reassigned subtask ‹name› to ‹assignee› on ‹date, time›".
- Enforced on both sides: the task page hides the restricted controls (`canEditDetails`, `canDelete`), and the server actions (`updateTaskFieldsAction`, `deleteTaskAction`) re-check, so a stale client or direct call cannot bypass them.

### 5.14 New tasks start unassigned; division members pull them

A newly created **division** task has **no owner yet** — it is left owned by its creator, which the pull flow treats as "unassigned". The task is already visible to the whole division through the division-scoped visibility clause (§5.1), so any member can see it and **pull** it to take ownership. Creators do not name an owner up front.

- **Division task → starts unassigned.** The Owner row reads "Unassigned" until someone pulls it. Enforced in `createTaskAction` (the owner is left as the creator for `division`-visibility tasks).
- **PMU task → owner = that PMU's Team Leader** (the active user with `pmuRole = 'pmu_team_leader'` and `pmuId =` the PMU), falling back to the creator when unset. PMUs are the exception because PMU-team visibility is **owner-scoped** — a member sees tasks *owned by a teammate*, not a division board (§5.2) — so a PMU task must be owned by a PMU member to stay visible to the team. Resolved by `resolveDivisionOwner` (src/lib/rbac).
- **Personal task → owned by its creator** (unchanged; only the creator, the assigned owner, and collaborators ever see it — §5.11).
- **Pull (claim ownership).** Any active user who is a **member of the task's division** — its home members and users granted that division via `user_division_access` (§5.18) — may pull an unassigned, non-personal, top-level task and become its owner — `pullTaskAction`, surfaced as the **Pull task** button on the task detail page (shown when `ownerId === createdById`, the viewer is not already the owner, and the task is a non-personal top-level task in a division the viewer is a member of). Pulling logs a `task_pulled` activity event and notifies the creator.
- **Changing the Division/PMU later still reassigns ownership** to the new division's Head or the new PMU's Team Leader — `updateTaskFieldsAction` (when the Division/PMU changes) reassigns, logs an `owner_changed` activity event, and notifies the new owner. `resolveDivisionOwner` backs this path.
- The Division/PMU selector is populated from Structure & Hierarchy (divisions + their PMUs): the create form's picker (heads see divisions they head + those PMUs; OSD/Super Admin see all), the task-detail **Change division** control, and the `/tasks` division filter. Everything downstream — visibility, dashboards, filters, notifications — follows because it keys off the resulting `divisionId` / `ownerId`.

### 5.15 Collaborator contribution rights

Being an **explicit collaborator** on a task (any `task_collaborators` role — `collaborator`, `division_lead`, or `co_owner`) grants a bounded set of **contribute** rights, distinct from working or redefining the task (§5.13). A collaborator may:

- **Add documents** — upload files or paste Drive links on the task. Gated by `canAddTaskAttachments` (= `canEditTaskAttachments` OR collaborator), enforced in the presign route (`/api/attachments/upload-url`) and both register/drive-link actions. A collaborator can still delete or rename **only files they uploaded themselves** (the uploader check) — not another user's; managing others' files stays with `canEditTaskAttachments` (owner / creator / OSD / Super Admin).
- **Edit the context** — the task **description** only. Enforced in `updateTaskFieldsAction`: a collaborator-only editor whose submission touches any field other than `description` is rejected. Every other field (name, due date, visibility, recurrence, division, sub-division) keeps its existing, stricter gate.
- **Create subtasks** — `addSubtaskAction` now admits collaborators alongside owner / creator / head. This reverses the earlier "a collaborator cannot break a task down" restriction, by product decision; a subtask still inherits the parent's visibility, and the assignee must be a task participant (§5.3). A plain division member who merely *sees* the task (not a collaborator) still cannot add subtasks.

Contribute rights do **not** include changing status/priority, reassigning or completing existing subtasks, transferring/deleting the task, or editing its definition. The client mirrors each gate (`isCollaborator` on the task page drives the Context edit affordance, the subtask **Add** button via `canAdd`, and the attachment **Upload/Add link** buttons via `canAdd`).

### 5.16 Subtask lifecycle — delete and transfer

Subtasks are first-class tasks (`parent_task_id` set), so they reuse the task page and its actions, with two subtask-specific rules:

- **Delete** — a subtask may be deleted only by the **owner of the parent task**, the **head of the subtask's division** (direct or delegate), or a **Super Admin**. The subtask's own **assignee cannot delete it** — they were allotted the work, they do not own its lifecycle. There is no personal-owner self-delete path for subtasks (unlike top-level personal tasks). Enforced in `deleteTaskAction` (the `parentTaskId` branch) and mirrored by `canDelete` on the task page.
- **Transfer** — subtasks are transferable. The current owner (the assignee) hands the subtask to another user through the same **Transfer task** button, drawing from the same division-scoped dropdown as a top-level transfer (`fetchTransferTargets` → `canTransferTaskTo`: own division, division head(s), Super Admin) and requiring the same mandatory hand-off comment. Unlike a top-level personal task, a **personal subtask is not auto-promoted to `division`** on transfer — a subtask must never become more permissive than its parent (§5.1), so its visibility is left untouched.

### 5.17 Document at subtask creation

- **Cross-division participation is now expressed by membership, not a hardcoded link.** The former `CROSS_DIVISION_PARTICIPANT_LINKS` (the symmetric Khelo India / Khelo India Mission ↔ NSDF participant pairs, open to all members) has been **deleted from the code**. A user only participates in another division's tasks — as a collaborator, subtask assignee, or @mention — when a Super Admin has granted them that division via `user_division_access`, which makes them an ordinary member of it (§5.3, §5.18). There is no automatic all-members cross-division link any more.
- **Attach a document while creating a subtask.** The Add-subtask form offers an optional **document upload** (with an optional display name). The file is stored against the new subtask through the standard presign → PUT → register flow (`scope: 'task'`, `parentId` = the subtask id), so it reuses the same permission gate (`canAddTaskAttachments`) and storage path as any task attachment. The document's display name is surfaced **on the parent task's subtask panel** as a quick-view link (view route for uploads, raw URL for Drive links); full management (rename / delete / share / add more) stays on the subtask's own page. Requires object storage to be configured; when it is not, the upload control is disabled and the file can still be added from the subtask page.

### 5.18 Multi-division membership (admin-granted extra divisions)

A user has exactly **one home division** (`users.division_id`), which is unchanged and still drives ownership, display, PMU home, and reference-number identity. On top of that, a **Super Admin** can grant a user **extra divisions**, so a single user can be a full member of several divisions at once.

- **Where it is granted.** In **Super Admin → Users**, the create / edit user form carries an **Additional divisions** checkbox list. Ticking a division inserts a `user_division_access` row (§ DATA_MODEL.md); un-ticking removes it. The home division is not listed there — it is set by the ordinary Division field.
- **Member set.** A user's member set is `[home division_id, ...user_division_access divisions]`. It is resolved by `getMemberDivisionIds(userId)` / `getMemberDivisionsByUser()` (`src/lib/rbac/index.ts`) and carried on `RbacActor.memberDivisionIds` / `RbacTarget.memberDivisionIds` (`src/lib/rbac/rules.ts`). The visibility scopers union the member set — the officer / JS / PMU branches of `src/lib/visibility-rules.ts` for tasks, and the `markedTo` clause in `src/lib/timeline-files.ts` for Timeline Files — and participant checks add a `{ divisionAccess: { some: { divisionId } } }` clause in `src/lib/task-participants.ts`.
- **What membership grants (member-level access) in every member division:**
  - full board visibility of that division's **tasks** and its **Timeline Files**;
  - being a task **participant** — collaborator, subtask assignee, or @mention target (§5.3, §5.9);
  - being **assigned / transferred** a task, or **pulling** an unassigned division task (§5.6, §5.14);
  - **grouping the task list by division** across the member set;
  - and, for a **Director** who is a member, managing that division's tasks (the director clause in `canManageTask` / `canEditTaskDetails`).
- **What membership does NOT grant.** No head powers whatsoever — no delete, no delegation, no curation — and **no division-task creation** (§5.11): a non-head member still creates personal tasks only. Head powers stay strictly on `headedDivisionIds` and are never widened by a membership grant.
- **Replaces the retired hardcoded links.** Cross-division collaboration that used to be wired in code — `CROSS_DIVISION_ALLOCATION_LINKS` (Khelo India → NSDF allocation, §5.6), `CROSS_DIVISION_PARTICIPANT_LINKS` (KI / KIM ↔ NSDF participation, §5.17), and the per-username `CROSS_DIVISION_VIEW_GRANTS`, along with `getAllocatableDivisionIds`, `getLinkedParticipantDivisionIds`, `linkedParticipantAbbreviations`, and `RbacActor.allocatableDivisionIds` — is **removed**. The Super Admin now grants the specific users who need such reach an extra membership instead. This is a **behaviour change**: the old blanket KI/KIM ↔ NSDF links no longer apply automatically, so the specific users are re-granted per user. The migration seeds the two named users **yogesh** and **vaishali** into **SGM** and **Autonomous Bodies** memberships.

### 5.19 PMU Team Head admin scope

Each PMU inside a division has one **PMU Team Head** — the PMU member with `users.pmu_role = 'pmu_team_leader'` (active). A **Super Admin** designates the head directly on the **Structure & Hierarchy** page (`setPmuTeamHeadAction` + the `PmuTeamHeadCard`). **One card per PMU**, shown on the parent division (one for each PMU under it) and on the PMU node itself; the card lists the active members of **that PMU** (`users.pmu_id`), and promoting one demotes any previous head of that same PMU to `pmu_senior_consultant`, so a PMU has at most one head and sibling PMUs are untouched. *(Per-PMU from 2026-09-17: the action previously keyed on the parent division, which conflated the heads of a division's several PMUs — see CLAUDE.md.)* The head administers the **PMU team only** — the team being every active PMU member sharing the head's division and PMU attachment (`pmu_id`, matched as-is so the common "flagged member in a normal division, `pmu_id = null`" case groups by division). `getPmuTeamMemberIds(userId)` (`src/lib/pmu-team.ts`) resolves the team, returning `[]` for anyone who is not an active team head, so the scope is inert for every other user.

- **Read.** The head additionally sees their team's **division-visibility** tasks. `buildVisibilityClausesFrom` (`src/lib/visibility-rules.ts`) emits an owner-scoped clause `{ visibility: 'division', ownerId: { in: <team ids> } }` from `opts.pmuTeamLeaderMemberIds`, populated by `buildVisibilityClauses`. A teammate's **personal** task stays private (the clause is `division`-scoped).
- **Manage.** Over a **division** task **owned by a team member**, the head may edit status / priority / context, manage subtasks, and add / remove collaborators (`canManageTask`'s `pmuTeamMemberIds` branch, gated on `visibility === 'division'`), attach / rename / delete documents (`canEditTaskAttachments`), and **allot / reassign** the owner — freely to another team member, otherwise via the normal transfer matrix (`reassignTaskAction`).
- **Delete — the team's OWN tasks only.** The head may **delete** a division task (and its subtasks) owned by a team member, via `canPmuHeadDeleteOwnedTask` (`deleteTaskAction`) — **but only when the task was NOT allotted (created) by an elevated role** (a Division Head, Super Admin, or OSD; `isElevatedOverDivision`). A task those roles hand the team stays under their exclusive delete control. Subtask delete keys on the **parent** task (not the subtask's assignee).
- **Documents — never an elevated role's upload.** The head may delete the team's documents, but **never a document uploaded by a Division Head / Super Admin / OSD** (`deleteAttachmentAction`, gated by `hasFullTaskAttachmentRights` + `isElevatedOverDivision`). The uploader themselves and full-rights holders (Super Admin / OSD / owner / creator) are unaffected.
- **Scope limits — the head never gains:** any power over the division's **non-PMU ministry tasks** (owner not on the team) or another PMU / division; **redefine** (name / due date / recurrence — `canEditTaskDetails`); **visibility / division** change; or delete of a task/document controlled by an elevated role. This is management of the team's board tasks, never division-head power.
- The grant flows through the shared `canManageTask` / `canEditTask` gates plus the dedicated delete helpers, so every server action honours it consistently, and the task-detail / task-list UIs mirror it exactly.
