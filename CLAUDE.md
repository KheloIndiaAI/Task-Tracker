# MYAS Task Tracker

> **Read this file at the start of every new session before touching any file.**

## Project

**MYAS Task Tracker** is a mobile-first task and workflow management tool for the Joint Secretary's office, Ministry of Youth Affairs & Sports, Government of India. It gives the JS and OSD a clear central view of everything in motion across divisions, sub-divisions, sections, and PMUs, while letting officers at every level create, assign, comment on, and complete tasks without friction. Target scale: 50–100 daily users initially, 100–200 at maturity. Geography: India only, Asia/Kolkata.

## Tech stack

- **Next.js 14** (App Router) — frontend + backend (Server Components, Server Actions, Route Handlers)
- **Postgres** — App owns the database. **Production: AWS RDS PostgreSQL 16** (ap-south-1, private, encrypted). Local dev: any Postgres (container or Neon)
- **Prisma** — ORM, schema, migrations. Prisma client lives in `src/lib/db/`
- **NextAuth (Auth.js)** with the Prisma adapter, Credentials provider (username + password), JWT sessions. Config in `src/lib/auth/`
- **S3-compatible object storage** for task attachments — default deployment target: **AWS S3 `ap-south-1` (Mumbai)** for India data residency. Swappable to **MinIO** (fully on-prem) or **Cloudflare R2** (cheap, no egress) without code changes; wire via the AWS SDK
- **Tailwind CSS** for styling, on top of the CSS custom-property token system in [docs/COLOUR_TOKENS.css](docs/COLOUR_TOKENS.css)
- **Sortable.js** for drag-and-drop *(Phase 2 — JS Priority Board, hierarchy mapper)*
- **Tabler Icons** (outline by default; filled only inside pills) from `@tabler/icons-webfont@2.44.0`
- **Google Fonts**: Manrope (body/UI), Newsreader (headings/quotes), JetBrains Mono (ref numbers, usernames)

**Deferred** (decide when the first screen exists, not before): form library (`react-hook-form` + `zod` likely), server-state cache (TanStack Query likely). *Hosting & CI are decided — production runs on **AWS ECS Fargate** (ap-south-1) with **GitHub Actions** CI/CD triggered from the `dev` branch; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).*

## Local development

One-time setup:

1. **Postgres** — any URL works. Neon (managed, free tier, paste the URL) or a local container both fine:
   ```bash
   docker run -d --name myas-postgres \
     -p 5432:5432 \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=myas \
     postgres:16
   ```
   Then set `DATABASE_URL` in `.env`.

2. **MinIO** for S3-compatible storage (so attachment uploads work locally without an AWS account):
   ```bash
   docker run -d --name myas-minio \
     -p 9000:9000 -p 9001:9001 \
     -e MINIO_ROOT_USER=minioadmin \
     -e MINIO_ROOT_PASSWORD=minioadmin \
     -v myas-minio-data:/data \
     quay.io/minio/minio server /data --console-address ":9001"
   ```
   Open `http://localhost:9001`, log in `minioadmin` / `minioadmin`, create a bucket called `myas-attachments`. The same code paths work against production AWS S3 in `ap-south-1` — only env vars change.

3. **Copy `.env.sample` to `.env`** and fill in `DATABASE_URL`, `AUTH_SECRET` (generate with `openssl rand -base64 32`), and the bootstrap super-admin credentials.

Daily loop:

```bash
pnpm install                 # first time only
pnpm db:generate             # regenerate Prisma client after schema changes
pnpm db:migrate              # create + apply a migration
pnpm db:seed                 # populate mock data from docs/MOCK_DATA.md
pnpm dev                     # http://localhost:3000
```

`npm` and `yarn` work too — the scripts are package-manager-agnostic.

### Troubleshooting — a feature "breaks" but the code looks correct

First suspect **schema drift**: the dev database can fall behind
`prisma/migrations`, so columns/tables the generated Prisma client selects don't
exist yet and every query against those models throws. Because the client
selects all schema columns, a single missing column (e.g. `timeline_files.task_seq`)
can take out whole flows — the tasks list, a Timeline File's detail page, or
Create-Task-from-a-file — while the code is perfectly fine.

Check and fix before hunting a code bug:

```bash
pnpm exec prisma migrate status      # lists any un-applied migrations
pnpm db:migrate:deploy               # applies them (prisma migrate deploy)
```

To probe the live schema/data safely, run a `tsx` script **from the project
root** (so `@/…` and `@prisma/client` resolve), load `.env` yourself, and wrap
any writes in a `prisma.$transaction` that throws to roll back — so a
verification never persists test rows.

## Build phases — copied verbatim from PRD §11

### Phase 1 — Foundation *(ACTIVE)*
- Super Admin Console: Structure & hierarchy + Users sub-sections; create users, divisions, hierarchy
- Login + profile + password change
- Task module: create, edit, comment, attach, recurrence, visibility, priority, subtasks
- Quick Create
- Per-task Activity log
- Search & basic filters

### Phase 2 — Coordination *(PENDING)*
- JS Priority Board with drag-and-drop (horizontal multi-lane)
- OSD Command Centre
- Notifications
- Cross-division task UI
- Role switcher (Super Admin ↔ Command Centre)

### Phase 3 — Files & Calendar *(PENDING)*
- Timeline Files module with Level 2 linking
- Per-Timeline-File Activity log
- Milestone Calendar
- Audit Trail page (full system-wide)
- Tags & Labels sub-section

### Phase 4 — Polish *(PENDING)*
- Mobile gesture refinements
- Bulk import sub-section
- Performance hardening, role-based view tests
- Settings sub-section

## Current build phase tracker

| Phase | Status |
|---|---|
| Phase 1 — Foundation | Complete |
| Phase 2 — Coordination | Complete |
| Phase 3 — Files & Calendar | Complete |
| Phase 4 — Polish | **Active** — see notes below |

### Phase 4 status detail

- Settings sub-section — done
- Bulk import sub-section — done
- Recurrence editor, TF more-menu, Marked-to editor, Mention picker, Global search — done
- S3 attachments end-to-end (presign + register + delete + Drive-link fallback) — done; activates the moment `S3_*` env vars are present
- Mobile gestures — swipe-to-mark-read on `/notifications` rows, pull-to-refresh on `/tasks` — done (swipe-to-archive removed with the Archive feature)
- Performance hardening — `loading.tsx` skeletons on `/tasks`, `/timeline-files`, `/admin/audit`, `/search`; index audit complete (see [docs/PERF_NOTES.md](docs/PERF_NOTES.md))
- Subtask user assignment with datetime deadline — assignees from same division, deadline validated against parent task — done
- Task transfer — owner can hand off a task to another same-division user; activity trail + creator notification — done
- PWA install — manifest, icons/splash from the brand logo, conservative service worker (offline fallback only, NOT offline mode), phone-only install prompt card — done (see [docs/PWA.md](docs/PWA.md))
- **Deferred infrastructure work** — automated tests (visibility scoper, role-based view tests, server-action contract tests). Requires Vitest setup + a CI workflow; track as a separate epic.

## The two-font system

- **Manrope** (300–700) — body, UI labels, buttons, navigation.
- **Newsreader** (400, 500, opsz 6–72) — H1, modal titles, Secretary's quote callouts, select large numbers.
- **JetBrains Mono** (400, 500) — usernames, Timeline File reference numbers (`TF-YYYY/NNN`), system IDs.

All three are loaded from Google Fonts. **Never substitute.** No system-ui fallback for design purposes; if the network is offline, the page may render in the browser default but the fonts must remain Manrope / Newsreader / JetBrains Mono in the codebase.

Use only weights 400 and 500 inside a single component — no mid-sentence bolding, no 600/700. Hierarchy comes from size, colour, and family changes (sans → serif for headings), not weight stacking.

## The two-accent rule

The system has exactly two accent colours, each with a fixed meaning. **Never swap.**

- **Amber `#b45309`** — JS Priority signal **only**. Used on:
  - JS Priority badge ("JS — today", "JS — week", etc.)
  - JS Priority Board lane counts and left-stripe on JS-priority task cards
  - Deadline countdown pills on Timeline Files
  - "Approval needed" hint on sideways/upward reassignment
  - Contract role override on officer avatars

- **Indigo `#1e1b4b`** — Super Admin surface + Timeline File reference. The "structure" signal. Used on:
  - Super Admin Console chrome and selection rings
  - Timeline File title block, ref-number chip, linked-TF card, Secretary's quote border
  - Milestone pill
  - @mention chips
  - All hierarchy slot tones (lightening as the slot descends)

If you are about to use amber for anything that isn't a JS Priority signal, stop. If you are about to use indigo for anything that isn't Super Admin or a Timeline File, stop. Status and priority have their own colours (see [docs/COLOUR_TOKENS.css](docs/COLOUR_TOKENS.css) §1.3).

**Documented exception (2026-07-09):** the JS Priority Board's lane *background* washes intentionally invert this rule — Today/This week/This month use indigo, Watchlist uses amber (`LANE_TINT` in `Board.tsx`). This was an explicit product decision for that one board. The JS Priority badge, lane counts, and left-stripe on JS-priority task cards elsewhere are unaffected and stay amber.

## Permission model summary

Permissions are **hierarchy-driven**:

- A user sees their own tasks plus everything owned by anyone below them in their chain.
- A **Director** sees their entire division (sub-divisions, sections, subordinates).
- A **Section Officer** sees their section and everything under it.
- **JS** sees their own tasks plus the OSD-curated JS Priority Board.
- **OSD** sees everything (Command Centre) and can toggle into Super Admin.
- **Super Admin** has unrestricted access to any page or view; same person as OSD initially.

PMU isolation:
- **Ministry officers in a division can see their PMU's tasks** (collaboration).
- **PMU members see only PMU-tagged tasks in their division** — never internal ministry tasks unless explicitly added as a collaborator.

Visibility flag on each task:
- `Personal` — visible only to the creator, **not even to superiors**.
- `Division` — follows the hierarchy rules above.
- **Creating a `Division` task (or changing visibility either way) is a head power**: Super Admin, OSD, the division's head (`divisions.head_user_id`), or an active delegate (`division_access_delegations`). Everyone else creates `Personal` tasks only — enforced by `canCreateDivisionTask` in `src/lib/rbac/rules.ts` and gated again in `createTaskAction` / `updateTaskFieldsAction`. The same rule covers spawning tasks from a Timeline File.

Multi-division full membership:
- A user has **one home division** (`users.division_id`) — still drives ownership, display, PMU home, and reference-number identity. A **Super Admin** can grant a user **extra divisions** via the `user_division_access` join table (managed in Super Admin → Users, the "Additional divisions" checkbox list); the member set = home + granted, resolved by `getMemberDivisionIds` and unioned in the visibility scopers and participant checks.
- In every member division the user gets **member-level access**: full task + Timeline-File board visibility, participation (collaborator / subtask assignee / @mention), assignment/transfer target, pull, and Director-member task management — but **no head powers and no division-task creation**. Head powers stay strictly on `headedDivisionIds`.
- This **retires the hardcoded NSDF ↔ KI/KIM links** (`CROSS_DIVISION_ALLOCATION_LINKS`, `CROSS_DIVISION_PARTICIPANT_LINKS`, `CROSS_DIVISION_VIEW_GRANTS` and their helpers are deleted); cross-division reach is now admin-managed per user via `user_division_access`. See PERMISSIONS.md §5.18.

Reassignment:
- Downward within own chain — free.
- Sideways or upward — requires superior's tap-approval; the "Approval needed" amber badge appears on those rows in the assignee picker.

Deletion (the Archive / soft-delete feature has been removed from the platform):
- Delete (hard) — the **head of the task's division** (direct head or active delegate) or a **Super Admin** (any task), plus a user for their **own personal task**. Removes the task and its subtasks/comments/attachments; cannot be undone. Enforced in `deleteTaskAction` via `canActAsHeadOf`.
- Timeline File — hard-delete is Super Admin only (any file, regardless of creator).
- **Timeline File archive (reversible soft-delete)** — OSD or Super Admin may **archive / restore** a Timeline File (`archiveTimelineFileAction` / `unarchiveTimelineFileAction`, gated by `requireOsdOrSuperAdmin`). Archiving sets `archived_at` / `archived_by`; archived files drop out of the active list, counts, calendar and search, and are shown only under the "Archived TL files" list toggle and the (read-only) detail page, from which they can be restored. Visibility is unchanged — archiving never widens who can see a file.
- For **tasks**, the `archived_at` / `archived_by` columns and the `archivedAt: null` "hide archived" read filters remain in the schema, but no code path sets them (there is no task Archive/Restore action). Only Timeline Files have the archive feature.

Planning calendar (`/calendar`):
- One view for three kinds — **JS engagements** (teal), **task deadlines** (dark blue, every visible task with a due date), **Timeline file deadlines** (red). Tasks/TFs reuse their normal scopers, so division-only and PMU-team-only visibility hold on the calendar exactly as on the lists.
- **JS Engagements are Office-of-JS-only**: only members of the seeded `Office of JS` division and Super Admins can see or manage them (`canAccessEngagements`, `src/lib/engagements.ts`; model `JsEngagement`). See PERMISSIONS.md §5.12.

Full matrix lives in [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Do NOT build yet — out of Phase 1 scope

Anything in this list gets a `// TODO: Phase N` comment if encountered and nothing else.

**Phase 2:**
- JS Priority Board with drag-and-drop, lanes, badge propagation
- OSD Command Centre dashboard
- Notifications (bell, in-app delivery, triggers)
- Cross-division task UI ("Primary: [Division]" badge, division-leads)
- Role switcher (Super Admin ↔ Command Centre)

**Phase 3:**
- Timeline Files module — all of it: ref-no generation, Secretary's quote, linked tasks panel, action document upload, Level 2 spawning
- Per-Timeline-File Activity log
- Milestone Calendar (month / week / list views)
- Audit Trail page (system-wide)
- Tags & Labels Super Admin sub-section

**Phase 4:**
- Mobile gesture refinements (swipe actions, etc.)
- Bulk import sub-section
- Settings sub-section
- Performance hardening, role-based view tests

**Permanently out of scope (v1):**
- Self-service sign-up
- Email-based password reset
- Email / SMS / WhatsApp notifications
- JS personal notepad
- Two-way auto-sync between Timeline File status and linked task statuses
- External API integrations (eOffice, DARPG portals, etc.)
- Multi-language support
- Offline mode

## Project-wide constraints

1. **Read this CLAUDE.md at the start of every new session before touching any file.**
2. **Never use a colour not in the token system.** No hardcoded hex values in components — always CSS variables.
3. **Sentence case everywhere.** No "Task Created Successfully". Write "Task created". No exclamation marks. No emojis. No ALL CAPS in body content (uppercase only via CSS on section-header labels).
4. **Responsive at every breakpoint.** Three layouts, one design system:
   - **Mobile (< 768 px)** — 390 px reference. Header + drawer; FAB for primary action; single-column content.
   - **Tablet (768–1024 px)** — sidebar collapsed to icons; header with search; 2-column content where applicable.
   - **Laptop+ (≥ 1024 px)** — sidebar with labels; centred max-width content; "+ New" button replaces FAB.
   The mobile prototypes still drive the visual grammar (token colours, type scale, pill/avatar/card shapes); larger viewports re-flow those same components into a website chrome. The Super Admin Console (`/admin/*`) is desktop-first; mobile collapses it into a single column.
5. **Semantic HTML only.** No clickable `<div>`s. Use `<button>`, `<a>`, `<input>`, `<section>`, `<article>`, `<main>`, `<header>`, `<time>`.
6. **Tabler Icons only** (outline by default; filled only inside pills as specified in Design Tokens §4). Icons in interactive elements get `aria-hidden="true"` when paired with a text label.
7. **Phase 1 scope is the only active scope.** Any feature outside Phase 1 gets a `// TODO: Phase N` comment and nothing else.
8. **When in doubt about a visual decision, the HTML prototypes override everything — including this file and the PRD.**

## Reference paths

| Document | Path |
|---|---|
| Product Requirements | [PRD_Sports_Ministry_Task_Tracker_v1.1.md](PRD_Sports_Ministry_Task_Tracker_v1.1.md) |
| Design tokens & patterns | [Design_Tokens_and_Patterns.md](Design_Tokens_and_Patterns.md) |
| Data model | [docs/DATA_MODEL.md](docs/DATA_MODEL.md) |
| Permissions matrix | [docs/PERMISSIONS.md](docs/PERMISSIONS.md) |
| Component catalogue | [docs/COMPONENTS.md](docs/COMPONENTS.md) |
| PWA (manifest, service worker, install prompt) | [docs/PWA.md](docs/PWA.md) |
| Document Centre (executive records module) | [docs/DOCUMENT_CENTRE.md](docs/DOCUMENT_CENTRE.md) |
| Colour tokens (CSS) | [docs/COLOUR_TOKENS.css](docs/COLOUR_TOKENS.css) |
| Mock data spec | [docs/MOCK_DATA.md](docs/MOCK_DATA.md) |
| Prototype 1 — task list + JS Priority Board (mobile) | [prototypes/myas_task_tracker_prototype.html](prototypes/myas_task_tracker_prototype.html) |
| Prototype 2 — task detail (mobile) | [prototypes/myas_task_detail_prototype.html](prototypes/myas_task_detail_prototype.html) |
| Prototype 3 — Timeline File detail (mobile) | [prototypes/myas_timeline_file_prototype.html](prototypes/myas_timeline_file_prototype.html) |
| Prototype 4 — Super Admin · Structure & hierarchy (desktop) | [prototypes/myas_super_admin_prototype.html](prototypes/myas_super_admin_prototype.html) |
