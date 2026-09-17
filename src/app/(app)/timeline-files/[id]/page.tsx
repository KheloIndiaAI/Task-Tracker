import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';

import {
  AttachmentList,
  type AttachmentRow,
  BackButton,
  CollapsibleSection,
  GlassDetailPanel,
  Pill,
} from '@/components/ui';
import { canEditTfAttachments } from '@/app/actions/attachments';
import {
  postTfCommentAction,
  editTfCommentAction,
  deleteTfCommentAction,
} from '@/app/actions/timeline-files';
import { Discussion, type Mentionable } from '@/components/discussion/Discussion';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ACTOR_SUMMARY_SELECT, USER_SUMMARY_SELECT } from '@/lib/prisma-selects';
import { initialsOf } from '@/lib/format';
import { canCreateTaskOutsideOwnDivisions, getRbacActor } from '@/lib/rbac';
import { isS3Configured } from '@/lib/s3';
import { buildTfVisibilityClause } from '@/lib/timeline-files';
import { cn } from '@/lib/utils';

import { DeskCommentSection } from './_components/DeskCommentSection';
import { LinkedTasksSection, type LinkedTaskRow } from './_components/LinkedTasksSection';
import {
  MarkedToEditor,
  type DivisionOption,
} from './_components/MarkedToEditor';
import { SecretaryQuoteSection } from './_components/SecretaryQuoteSection';
import { TfActivitySection } from './_components/TfActivitySection';
import { TfDeadlineEditor } from './_components/TfDeadlineEditor';
import { TfMoreMenu } from './_components/TfMoreMenu';
import { TfPriorityPicker } from './_components/TfPriorityPicker';
import { TfRefNumberEditor } from './_components/TfRefNumberEditor';
import { TfStatusPicker } from './_components/TfStatusPicker';
import { TfTitleEditor } from './_components/TfTitleEditor';

type PageProps = { params: { id: string } };

function canEditFieldsHelper(me: { hierarchySlot: string; isSuperAdmin: boolean }): boolean {
  return me.isSuperAdmin || me.hierarchySlot === 'osd';
}

const TF_STATUS_LABEL: Record<string, string> = {
  pending_action: 'Pending action',
  in_progress: 'In progress',
  awaiting_reply: 'Awaiting reply',
  on_hold: 'On hold',
  closed: 'Closed',
};

export default async function TimelineFileDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      hierarchySlot: true,
      isSuperAdmin: true,
      divisionId: true,
    },
  });
  if (!me) notFound();

  const visibility = await buildTfVisibilityClause(me);

  // Archived files are still shown here (read-only, with a Restore action) so
  // they can be reviewed and restored — visibility scoping is unchanged.
  const tf = await prisma.timelineFile.findFirst({
    where: {
      id: params.id,
      AND: [visibility],
    },
    include: {
      createdBy: { select: USER_SUMMARY_SELECT },
      markedTo: {
        include: {
          division: { select: { id: true, name: true, avatarColour: true } },
        },
      },
      taskLinks: {
        include: {
          task: {
            include: { owner: { select: USER_SUMMARY_SELECT } },
          },
        },
        orderBy: { linkedAt: 'asc' },
      },
      activity: {
        include: { actor: { select: ACTOR_SUMMARY_SELECT } },
        orderBy: { createdAt: 'desc' },
      },
      comments: {
        where: { parentCommentId: null },
        include: {
          user: { select: USER_SUMMARY_SELECT },
          replies: {
            include: { user: { select: USER_SUMMARY_SELECT } },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!tf) notFound();

  // Mentionables for the discussion typeahead: active users, capped for the
  // in-memory picker (filtered client-side).
  const mentionableRows = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      username: true,
      designation: true,
      division: { select: { avatarColour: true } },
    },
    orderBy: { name: 'asc' },
    take: 200,
  });
  const mentionables: Mentionable[] = mentionableRows.map((u) => ({
    id: u.id,
    name: u.name,
    username: u.username,
    designation: u.designation,
    divisionColour: u.division.avatarColour,
  }));

  // For the marked-to editor — OSD picks from any top-level division.
  const allDivisions: DivisionOption[] = canEditFieldsHelper(me)
    ? await prisma.division.findMany({
        where: { kind: 'division' },
        select: { id: true, name: true, avatarColour: true },
        orderBy: { displayOrder: 'asc' },
      })
    : [];

  // An archived file is read-only until restored: every edit affordance is
  // suppressed, leaving only the Restore action (for OSD / Super Admin).
  const isArchived = tf.archivedAt !== null;
  // Archive / restore matches the OSD/Super-Admin TF-management gate.
  const canArchive = me.isSuperAdmin || me.hierarchySlot === 'osd';

  const canEditFields =
    !isArchived && (me.isSuperAdmin || me.hierarchySlot === 'osd');
  const canEditStatus =
    !isArchived &&
    (me.isSuperAdmin ||
      me.hierarchySlot === 'osd' ||
      (me.hierarchySlot === 'director' &&
        tf.markedTo.some((m) => m.division.id === me.divisionId)));
  // Spawning a task from a TF always produces a division-level task, so
  // the head rule applies: Super Admin, OSD, or head/delegate of a marked
  // division. Others see the linked-task list without the create button.
  const actor = await getRbacActor(me.id);
  const creatableDivisionIds =
    !isArchived && actor
      ? tf.markedTo
          .map((m) => m.division.id)
          .filter((id) => canCreateTaskOutsideOwnDivisions(actor, id))
      : [];
  const canCreateTasks = creatableDivisionIds.length > 0;

  // Attachments — same gate as TF field editing for non-OSD directors of marked-to.
  const canEditAtt = isArchived ? false : await canEditTfAttachments(me.id, tf.id);
  const s3Ready = isS3Configured();

  // Source documents — many allowed
  const sourceRows = await prisma.attachment.findMany({
    where: { ownerType: 'timeline_file_source', ownerId: tf.id },
    include: { uploadedBy: { select: { name: true } } },
    orderBy: { uploadedAt: 'asc' },
  });
  const sourceAttachments: AttachmentRow[] = sourceRows.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    fileUrl: a.fileUrl,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    source: a.source as 'uploaded' | 'drive_link',
    uploadedAt: a.uploadedAt,
    uploaderName: a.uploadedBy.name,
    canDelete: canEditAtt || a.uploadedById === me.id,
  }));

  // Action documents — the office's response / outcome files. Multiple allowed;
  // TF.actionDocumentAttachmentId still tracks the most recent as canonical.
  const actionRows = await prisma.attachment.findMany({
    where: { ownerType: 'timeline_file_action', ownerId: tf.id },
    include: { uploadedBy: { select: { name: true } } },
    orderBy: { uploadedAt: 'asc' },
  });
  const actionAttachments: AttachmentRow[] = actionRows.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    fileUrl: a.fileUrl,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    source: a.source as 'uploaded' | 'drive_link',
    uploadedAt: a.uploadedAt,
    uploaderName: a.uploadedBy.name,
    canDelete: canEditAtt || a.uploadedById === me.id,
  }));

  // ---------- derive rendering data ----------

  const days = tf.deadlineDate ? daysUntil(tf.deadlineDate) : null;
  const isOverdue = days !== null && days < 0;
  const isClosed = tf.status === 'closed';

  const linkedTasks: LinkedTaskRow[] = tf.taskLinks.map((link) => ({
    id: link.task.id,
    name: link.task.name,
    status: link.task.status,
    priority: link.task.priority,
    due: link.task.dueDate,
    owner: {
      name: link.task.owner.name,
      divisionColour: link.task.owner.division.avatarColour,
    },
  }));

  const deadlineIso = tf.deadlineDate
    ? tf.deadlineDate.toISOString().slice(0, 10)
    : null;

  // Only divisions the caller may give tasks in — a head of one marked
  // division must not spawn tasks into the other marked divisions.
  const markedToOptions = tf.markedTo
    .filter((m) => creatableDivisionIds.includes(m.division.id))
    .map((m) => ({
      id: m.division.id,
      name: m.division.name,
      isOfficeOfJs: m.division.name === 'Office of JS',
    }));

  // Optional initial-owner pool for the create-from-file dialog: active members
  // of the divisions the caller may spawn into (any active user when Office of
  // JS is a target — the same rule createTaskAction enforces on save). Marked-to
  // targets are always kind:'division' (the marked-to editor offers no PMUs), so
  // a home-division match matches the server's membership check for this path.
  const hasOfficeOfJsTarget = markedToOptions.some((d) => d.isOfficeOfJs);
  const ownerCandidateRows =
    creatableDivisionIds.length > 0
      ? await prisma.user.findMany({
          where: {
            isActive: true,
            ...(hasOfficeOfJsTarget
              ? {}
              : {
                  OR: [
                    { divisionId: { in: creatableDivisionIds } },
                    // Admin-granted extra members of a target division may own
                    // a task spawned into it, matching the server check.
                    { divisionAccess: { some: { divisionId: { in: creatableDivisionIds } } } },
                  ],
                }),
          },
          select: {
            id: true,
            name: true,
            designation: true,
            divisionId: true,
            division: { select: { name: true, avatarColour: true } },
            divisionAccess: { select: { divisionId: true } },
          },
          orderBy: { name: 'asc' },
        })
      : [];
  const ownerCandidates = ownerCandidateRows.map((u) => ({
    id: u.id,
    name: u.name,
    designation: u.designation,
    divisionId: u.divisionId,
    memberDivisionIds: [u.divisionId, ...u.divisionAccess.map((a) => a.divisionId)],
    divisionName: u.division.name,
    divisionColour: u.division.avatarColour,
  }));

  // Stable signature line for the secretary's quote.
  const secretarySignature = `Secretary, Sports · ${format(tf.receivedDate, 'd LLL')}`;

  return (
    <GlassDetailPanel>
      {/* App-bar — glassy, rounded to the panel's top edge */}
      <header className="sticky top-14 md:top-16 z-10 glass-header border-b border-line-2 rounded-t-[26px]">
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 h-12">
          <BackButton
            fallbackHref="/timeline-files"
            label="Back to timeline files"
            hideLabelOnMobile
          />
          <TfMoreMenu
            tfId={tf.id}
            refNo={tf.refNo}
            canViewAudit={me.isSuperAdmin || me.hierarchySlot === 'osd'}
            canDelete={!!me?.isSuperAdmin}
            canArchive={canArchive}
            isArchived={isArchived}
          />
        </div>
      </header>

      {isArchived ? (
        <div className="flex items-center gap-2 px-4 md:px-6 py-2.5 border-b border-line-2 bg-line-2 text-[12px] text-ink-2">
          <i className="ti ti-archive text-[14px] text-ink-3" aria-hidden="true" />
          <span>
            This timeline file is archived and read-only.
            {canArchive ? ' Restore it from the menu to make changes.' : ''}
          </span>
        </div>
      ) : null}

      {/* Title block — a clear soft RED tint over the frosted glass (the
          Timeline-File colour on the calendar); stays coloured down to the
          divider so the hero reads as a distinct block. */}
      <section
        aria-labelledby="tf-title"
        className="px-4 md:px-6 py-5 border-b border-line-2"
        style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--urgent-soft) 92%, transparent) 0%, color-mix(in srgb, var(--urgent-soft) 62%, transparent) 100%)' }}
      >
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <TfRefNumberEditor
            tfId={tf.id}
            refNo={tf.refNo}
            refYear={tf.refYear}
            fileNumber={tf.refNo.split('/')[1] ?? String(tf.refSeq)}
            canEdit={!isArchived && me.isSuperAdmin}
          />
          <TfPriorityPicker tfId={tf.id} current={tf.priority} canEdit={canEditStatus} />
          <TfStatusPicker tfId={tf.id} current={tf.status} canEdit={canEditStatus} />
          {tf.deadlineDate && !isClosed && days !== null ? (
            <Pill variant="deadline" daysLeft={days} overdue={isOverdue} />
          ) : null}
        </div>

        <TfTitleEditor tfId={tf.id} subject={tf.subject} canEdit={canEditFields} />

        <p className="text-[12px] text-ink-2">
          From <span className="text-ink font-medium">{tf.fromWhom}</span>
          <span className="mx-1.5 text-ink-4">·</span>
          Received <span className="text-ink font-medium">{format(tf.receivedDate, 'd LLL yyyy')}</span>
        </p>
      </section>

      <SecretaryQuoteSection
        tfId={tf.id}
        comments={tf.secretaryComments}
        signature={secretarySignature}
        canEdit={canEditFields}
      />

      <DeskCommentSection
        tfId={tf.id}
        comments={tf.deskComments}
        canEdit={canEditFields}
      />

      <LinkedTasksSection
        tfId={tf.id}
        refNo={tf.refNo}
        defaultDueDate={deadlineIso}
        markedTo={markedToOptions}
        ownerCandidates={ownerCandidates}
        linkedTasks={linkedTasks}
        canCreateTasks={canCreateTasks}
      />

      <section className="px-4 md:px-6 py-5 border-b border-line-2">
        <h2 className="section-label mb-3">
          Source documents
          {sourceAttachments.length > 0 ? (
            <span className="ml-2 text-ink-3 text-[11px] tracking-normal normal-case font-normal">
              {sourceAttachments.length}{' '}
              {sourceAttachments.length === 1 ? 'file' : 'files'}
            </span>
          ) : null}
        </h2>
        <AttachmentList
          scope="tf_source"
          parentId={tf.id}
          attachments={sourceAttachments}
          canEdit={canEditAtt}
          s3Configured={s3Ready}
          mode="list-multi"
          emptyHint="The original correspondence and any supporting annexures live here."
        />
      </section>

      <section className="px-4 md:px-6 py-5 border-b border-line-2">
        <h2 className="section-label mb-3">
          Action documents
          {actionAttachments.length > 0 ? (
            <span className="ml-2 text-ink-3 text-[11px] tracking-normal normal-case font-normal">
              {actionAttachments.length}{' '}
              {actionAttachments.length === 1 ? 'file' : 'files'}
            </span>
          ) : (
            <span className="ml-2 text-ink-3 text-[11px] tracking-normal normal-case font-normal">
              Not yet uploaded
            </span>
          )}
        </h2>
        <AttachmentList
          scope="tf_action"
          parentId={tf.id}
          attachments={actionAttachments}
          canEdit={canEditAtt}
          s3Configured={s3Ready}
          mode="list-multi"
          emptyHint="The office's response — replies, orders, or outcome files — lives here."
        />
      </section>

      <Discussion
        entityField="id"
        entityId={tf.id}
        actions={{
          post: postTfCommentAction,
          edit: editTfCommentAction,
          del: deleteTfCommentAction,
        }}
        comments={tf.comments}
        mentionables={mentionables}
        currentUserId={me.id}
        canViewProfiles={me.isSuperAdmin || me.hierarchySlot === 'osd'}
        readOnly={isArchived}
      />

      {/* Details and the activity log live together in one collapsible panel
          at the bottom — consistent with the task / subtask pages. */}
      <CollapsibleSection
        title="File details"
        subtitle="From, received, deadline, marked to and activity"
        icon="ti-list-details"
      >
        <section className="px-4 md:px-6 py-5 border-b border-line-2">
          <h2 className="section-label mb-3">Details</h2>
          <dl className="flex flex-col gap-2.5">
            <Row icon="ti-mail-forward" label="From">
              {tf.fromWhom}
            </Row>
            <Row icon="ti-calendar-event" label="Received">
              {format(tf.receivedDate, 'd LLL yyyy')}
            </Row>
            <TfDeadlineEditor
              tfId={tf.id}
              deadlineDate={tf.deadlineDate}
              canEdit={canEditFields}
            />
            <Row icon="ti-building" label="Marked to">
              <MarkedToEditor
                tfId={tf.id}
                current={tf.markedTo.map((m) => m.division)}
                allDivisions={allDivisions}
                canEdit={canEditFields}
              />
            </Row>
            <Row icon="ti-user" label="Created by">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="w-5 h-5 rounded-full text-white text-[9px] font-medium grid place-items-center"
                  style={{ backgroundColor: tf.createdBy.division.avatarColour }}
                  aria-hidden="true"
                >
                  {initialsOf(tf.createdBy.name)}
                </span>
                {tf.createdBy.name}
                <span className="text-ink-3 text-[11px] font-normal">
                  · {formatDistanceToNow(tf.createdAt, { addSuffix: true })}
                </span>
              </span>
            </Row>
          </dl>
        </section>

        <TfActivitySection
          activity={tf.activity.map((a) => ({
            ...a,
            payload: (a.payload ?? {}) as Record<string, unknown>,
          }))}
        />
      </CollapsibleSection>
    </GlassDetailPanel>
  );
}

// ------------------------------------------------------------
// Row + helpers
// ------------------------------------------------------------

function Row({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <i
        className={cn('ti', icon, 'text-[16px] text-ink-3 shrink-0 w-[18px]')}
        aria-hidden="true"
      />
      <span className="text-[13px] text-ink-2 w-[100px] shrink-0">{label}</span>
      <span className="flex-1 text-[13px] text-right font-medium text-ink">{children}</span>
    </div>
  );
}

function daysUntil(d: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
