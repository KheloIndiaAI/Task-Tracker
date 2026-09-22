/**
 * MYAS Task Tracker — Mock data seed
 *
 * Additive: does NOT delete existing data. Idempotent: checks for
 * "Khelo India Division" before proceeding; exits early if already seeded.
 *
 * Prerequisites: bootstrap user (isSuperAdmin=true) and "Office of JS"
 * division already exist from prisma/seed.ts.
 *
 * Run with:
 *   npx tsx prisma/seed-mock.ts
 */

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();

const MOCK_PASSWORD = 'Test1234!';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d;
}

function todayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

function daysAgo(n: number): Date {
  return daysFromNow(-n);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('seed-mock: checking if already seeded…');

  const taskCount = await prisma.task.count();
  const divisionsExist = await prisma.division.findFirst({
    where: { name: 'Khelo India Division' },
  });

  if (taskCount > 0) {
    console.log(`seed-mock: ${taskCount} tasks already exist — skipping.`);
    return;
  }

  // Divisions/users may already exist from a prior partial seed — skip creating them if so
  const skipStructure = !!divisionsExist;

  console.log('seed-mock: starting…');

  // -------------------------------------------------------------------------
  // 0. Look up bootstrap data
  // -------------------------------------------------------------------------
  const osd = await prisma.user.findFirst({ where: { isSuperAdmin: true } });
  if (!osd) throw new Error('Bootstrap super admin user not found. Run prisma/seed.ts first.');

  const officeOfJs = await prisma.division.findFirst({ where: { name: 'Office of JS' } });
  if (!officeOfJs) throw new Error('"Office of JS" division not found. Run prisma/seed.ts first.');

  const passwordHash = await hashPassword(MOCK_PASSWORD);

  // -------------------------------------------------------------------------
  // 1. Divisions
  // -------------------------------------------------------------------------
  let khiDiv: { id: string }, abDiv: { id: string }, khiOperations: { id: string },
    abNada: { id: string }, abNcssr: { id: string }, abSai: { id: string }, kimPmu: { id: string };
  let uJs: { id: string }, uDirKhi: { id: string }, uDysKhi: { id: string }, uUsKhi: { id: string },
    uSoKhiYp: { id: string }, uAsoKhi: { id: string }, uDirAb: { id: string },
    uUsAbPo: { id: string }, pTl: { id: string }, pSc: { id: string }, pC: { id: string };

  if (skipStructure) {
    console.log('seed-mock: divisions and users already exist — looking them up…');
    const find = async (model: 'division' | 'user', where: Record<string, unknown>) => {
      const r = model === 'division'
        ? await prisma.division.findFirstOrThrow({ where: where as never })
        : await prisma.user.findFirstOrThrow({ where: where as never });
      return { id: r.id };
    };
    khiDiv = await find('division', { name: 'Khelo India Division' });
    abDiv = await find('division', { name: 'Autonomous Bodies' });
    khiOperations = await find('division', { name: 'Operations', parentId: khiDiv.id });
    abNada = await find('division', { name: 'NADA' });
    abNcssr = await find('division', { name: 'NCSSR' });
    abSai = await find('division', { name: 'SAI' });
    kimPmu = await find('division', { name: 'KIM PMU' });
    uJs = await find('user', { username: 'vivek.r' });
    uDirKhi = await find('user', { username: 'ravi.kumar' });
    uDysKhi = await find('user', { username: 'suresh.s' });
    uUsKhi = await find('user', { username: 'pooja.d' });
    uSoKhiYp = await find('user', { username: 'sneha.t' });
    uAsoKhi = await find('user', { username: 'meena.p' });
    uDirAb = await find('user', { username: 'anita.m' });
    uUsAbPo = await find('user', { username: 'rohit.m' });
    pTl = await find('user', { username: 'karan.v' });
    pSc = await find('user', { username: 'lekha.r' });
    pC = await find('user', { username: 'aditya.n' });
  } else {
  console.log('seed-mock: creating divisions…');

  // Every division sits in an organization (2026-09-21) — the mock divisions
  // join the one Office of JS is in (Ministry Headquarter, from seed.ts).
  khiDiv = await prisma.division.create({
    data: {
      name: 'Khelo India Division',
      kind: 'division',
      avatarColour: '#4338ca',
      hasPmu: true,
      displayOrder: 1,
      createdById: osd.id,
      parentId: officeOfJs.parentId,
    },
  });

  const abDiv = await prisma.division.create({
    data: {
      name: 'Autonomous Bodies',
      kind: 'division',
      avatarColour: '#047857',
      hasPmu: false,
      displayOrder: 2,
      createdById: osd.id,
      parentId: officeOfJs.parentId,
    },
  });

  // Sub-divisions
  const khiOperations = await prisma.division.create({
    data: {
      name: 'Operations',
      kind: 'sub_division',
      parentId: khiDiv.id,
      avatarColour: '#4338ca',
      hasPmu: false,
      displayOrder: 0,
      createdById: osd.id,
    },
  });

  const abNada = await prisma.division.create({
    data: {
      name: 'NADA',
      kind: 'sub_division',
      parentId: abDiv.id,
      avatarColour: '#047857',
      hasPmu: false,
      displayOrder: 0,
      createdById: osd.id,
    },
  });

  const abNcssr = await prisma.division.create({
    data: {
      name: 'NCSSR',
      kind: 'sub_division',
      parentId: abDiv.id,
      avatarColour: '#047857',
      hasPmu: false,
      displayOrder: 1,
      createdById: osd.id,
    },
  });

  const abSai = await prisma.division.create({
    data: {
      name: 'SAI',
      kind: 'sub_division',
      parentId: abDiv.id,
      avatarColour: '#047857',
      hasPmu: false,
      displayOrder: 2,
      createdById: osd.id,
    },
  });

  // PMU (sibling row, kind=pmu)
  const kimPmu = await prisma.division.create({
    data: {
      name: 'KIM PMU',
      kind: 'pmu',
      pmuParentDivisionId: khiDiv.id,
      avatarColour: '#b45309',
      hasPmu: false,
      displayOrder: 3,
      createdById: osd.id,
    },
  });

  // -------------------------------------------------------------------------
  // 2. Users
  // -------------------------------------------------------------------------
  console.log('seed-mock: creating users…');

  // u-js
  const uJs = await prisma.user.create({
    data: {
      name: 'Vivek R.',
      username: 'vivek.r',
      passwordHash,
      designation: 'Joint Secretary',
      hierarchySlot: 'js',
      divisionId: officeOfJs.id,
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById: osd.id,
    },
  });

  // u-dir-khi
  const uDirKhi = await prisma.user.create({
    data: {
      name: 'Ravi Kumar',
      username: 'ravi.kumar',
      passwordHash,
      designation: 'Director, Khelo India Division',
      hierarchySlot: 'director',
      divisionId: khiDiv.id,
      supervisorId: osd.id,
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById: osd.id,
    },
  });

  // u-dys-khi
  const uDysKhi = await prisma.user.create({
    data: {
      name: 'Suresh S.',
      username: 'suresh.s',
      passwordHash,
      designation: 'Deputy Secretary',
      hierarchySlot: 'deputy_secretary',
      divisionId: khiDiv.id,
      subDivisionId: khiOperations.id,
      supervisorId: uDirKhi.id,
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById: osd.id,
    },
  });

  // u-us-khi
  const uUsKhi = await prisma.user.create({
    data: {
      name: 'Pooja D.',
      username: 'pooja.d',
      passwordHash,
      designation: 'Under Secretary',
      hierarchySlot: 'under_secretary',
      divisionId: khiDiv.id,
      subDivisionId: khiOperations.id,
      supervisorId: uDysKhi.id,
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById: osd.id,
    },
  });

  // u-so-khi-yp
  const uSoKhiYp = await prisma.user.create({
    data: {
      name: 'Sneha T.',
      username: 'sneha.t',
      passwordHash,
      designation: 'Young Professional',
      hierarchySlot: 'section_officer',
      contractRole: 'yp',
      divisionId: khiDiv.id,
      subDivisionId: khiOperations.id,
      supervisorId: uUsKhi.id,
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById: osd.id,
    },
  });

  // u-aso-khi
  const uAsoKhi = await prisma.user.create({
    data: {
      name: 'Meena P.',
      username: 'meena.p',
      passwordHash,
      designation: 'Assistant Section Officer',
      hierarchySlot: 'aso',
      divisionId: khiDiv.id,
      subDivisionId: khiOperations.id,
      supervisorId: uUsKhi.id,
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById: osd.id,
    },
  });

  // u-dir-ab
  const uDirAb = await prisma.user.create({
    data: {
      name: 'Anita M.',
      username: 'anita.m',
      passwordHash,
      designation: 'Director, Autonomous Bodies',
      hierarchySlot: 'director',
      divisionId: abDiv.id,
      supervisorId: osd.id,
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById: osd.id,
    },
  });

  // u-us-ab-po
  const uUsAbPo = await prisma.user.create({
    data: {
      name: 'Rohit M.',
      username: 'rohit.m',
      passwordHash,
      designation: 'Project Officer',
      hierarchySlot: 'under_secretary',
      contractRole: 'po',
      divisionId: abDiv.id,
      subDivisionId: abSai.id,
      supervisorId: uDirAb.id,
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById: osd.id,
    },
  });

  // p-tl (PMU)
  const pTl = await prisma.user.create({
    data: {
      name: 'Karan V.',
      username: 'karan.v',
      passwordHash,
      designation: 'Team Leader (KIM PMU)',
      hierarchySlot: 'section_officer',
      divisionId: khiDiv.id,
      isPmu: true,
      pmuRole: 'pmu_team_leader',
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById: osd.id,
    },
  });

  // p-sc (PMU)
  const pSc = await prisma.user.create({
    data: {
      name: 'Lekha R.',
      username: 'lekha.r',
      passwordHash,
      designation: 'Senior Consultant (KIM PMU)',
      hierarchySlot: 'section_officer',
      divisionId: khiDiv.id,
      isPmu: true,
      pmuRole: 'pmu_senior_consultant',
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById: osd.id,
    },
  });

  // p-c (PMU)
  const pC = await prisma.user.create({
    data: {
      name: 'Aditya N.',
      username: 'aditya.n',
      passwordHash,
      designation: 'Consultant (KIM PMU)',
      hierarchySlot: 'aso',
      divisionId: khiDiv.id,
      isPmu: true,
      pmuRole: 'pmu_consultant',
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById: osd.id,
    },
  });

  // Update bootstrap OSD: supervisor = u-js
  await prisma.user.update({
    where: { id: osd.id },
    data: { supervisorId: uJs.id },
  });
  } // end if/else skipStructure

  // -------------------------------------------------------------------------
  // 3. Timeline Files
  // -------------------------------------------------------------------------
  console.log('seed-mock: creating timeline files…');

  const tf34 = await prisma.timelineFile.create({
    data: {
      refNo: 'TF-2026/34',
      refYear: 2026,
      refSeq: 34,
      subject: 'Cabinet brief request — Khelo India Mission',
      fromWhom: "Prime Minister's Office",
      receivedDate: new Date('2026-05-18'),
      deadlineDate: daysFromNow(3),
      status: 'in_progress',
      secretaryComments:
        'This brief is a priority. Please ensure all sub-component cost estimates are finalised and cleared by JS before circulation.',
      createdById: osd.id,
    },
  });

  const tf38 = await prisma.timelineFile.create({
    data: {
      refNo: 'TF-2026/38',
      refYear: 2026,
      refSeq: 38,
      subject: 'NADA compliance review note',
      fromWhom: 'Ministry of Health',
      receivedDate: new Date('2026-05-25'),
      deadlineDate: daysFromNow(7),
      status: 'pending_action',
      createdById: osd.id,
    },
  });

  const tf22 = await prisma.timelineFile.create({
    data: {
      refNo: 'TF-2026/22',
      refYear: 2026,
      refSeq: 22,
      subject: 'Asian Games delegation confirmation',
      fromWhom: 'Indian Olympic Association',
      receivedDate: new Date('2026-04-12'),
      deadlineDate: new Date('2026-04-30'),
      status: 'closed',
      createdById: osd.id,
    },
  });

  // -------------------------------------------------------------------------
  // 4. Attachments (source docs + action doc for TF-2026/22)
  // -------------------------------------------------------------------------
  console.log('seed-mock: creating attachments…');

  // TF-2026/34: 2 source documents
  await prisma.attachment.create({
    data: {
      ownerType: 'timeline_file_source',
      ownerId: tf34.id,
      fileName: 'PMO-note-cabinet-brief.pdf',
      fileUrl: '#',
      mimeType: 'application/pdf',
      source: 'uploaded',
      uploadedById: osd.id,
    },
  });

  await prisma.attachment.create({
    data: {
      ownerType: 'timeline_file_source',
      ownerId: tf34.id,
      fileName: 'Annexure-I.pdf',
      fileUrl: '#',
      mimeType: 'application/pdf',
      source: 'uploaded',
      uploadedById: osd.id,
    },
  });

  // TF-2026/38: 1 source document
  await prisma.attachment.create({
    data: {
      ownerType: 'timeline_file_source',
      ownerId: tf38.id,
      fileName: 'NADA-compliance-note.pdf',
      fileUrl: '#',
      mimeType: 'application/pdf',
      source: 'uploaded',
      uploadedById: osd.id,
    },
  });

  // TF-2026/22: 1 source document + 1 action document
  await prisma.attachment.create({
    data: {
      ownerType: 'timeline_file_source',
      ownerId: tf22.id,
      fileName: 'IOA-delegation-letter.pdf',
      fileUrl: '#',
      mimeType: 'application/pdf',
      source: 'uploaded',
      uploadedById: osd.id,
    },
  });

  const tf22ActionDoc = await prisma.attachment.create({
    data: {
      ownerType: 'timeline_file_action',
      ownerId: tf22.id,
      fileName: 'asian-games-delegation-confirmed.pdf',
      fileUrl: '#',
      mimeType: 'application/pdf',
      source: 'uploaded',
      uploadedById: osd.id,
    },
  });

  // Update TF-2026/22 with action document
  await prisma.timelineFile.update({
    where: { id: tf22.id },
    data: { actionDocumentAttachmentId: tf22ActionDoc.id },
  });

  // -------------------------------------------------------------------------
  // 5. Timeline file marked-to entries
  // -------------------------------------------------------------------------
  console.log('seed-mock: creating timeline file marked-to entries…');

  // TF-2026/34 → khi
  await prisma.timelineFileMarkedTo.create({
    data: { timelineFileId: tf34.id, divisionId: khiDiv.id },
  });

  // TF-2026/38 → ab
  await prisma.timelineFileMarkedTo.create({
    data: { timelineFileId: tf38.id, divisionId: abDiv.id },
  });

  // TF-2026/22 → khi + ab
  await prisma.timelineFileMarkedTo.create({
    data: { timelineFileId: tf22.id, divisionId: khiDiv.id },
  });
  await prisma.timelineFileMarkedTo.create({
    data: { timelineFileId: tf22.id, divisionId: abDiv.id },
  });

  // -------------------------------------------------------------------------
  // 6. Tasks (parents first, then subtasks)
  // -------------------------------------------------------------------------
  console.log('seed-mock: creating tasks…');

  // --- JS Priority: today lane ---
  // t-cabinet
  const tCabinet = await prisma.task.create({
    data: {
      name: 'Finalise Khelo India Mission cabinet note',
      description:
        'Prepare and circulate the final cabinet note for the Khelo India Mission, incorporating all sub-component cost estimates, stakeholder inputs, and JS review.',
      ownerId: uDirKhi.id,
      divisionId: khiDiv.id,
      status: 'in_progress',
      priority: 'urgent',
      jsPriorityLane: 'today',
      dueDate: todayAt(18, 0),
      milestone: true,
      linkedTimelineFileId: tf34.id,
      createdById: osd.id,
    },
  });

  // Subtasks on t-cabinet
  await prisma.task.create({
    data: {
      name: 'Draft outline structure with 9 sub-components',
      ownerId: uDirKhi.id,
      divisionId: khiDiv.id,
      status: 'completed',
      priority: 'urgent',
      parentTaskId: tCabinet.id,
      createdById: uDirKhi.id,
    },
  });

  await prisma.task.create({
    data: {
      name: 'Stakeholder map: PMO, MoF, SAI, NSFs',
      ownerId: uDirAb.id,
      divisionId: khiDiv.id,
      status: 'completed',
      priority: 'high',
      parentTaskId: tCabinet.id,
      createdById: uDirKhi.id,
    },
  });

  await prisma.task.create({
    data: {
      name: 'Cost analysis with MoF inputs',
      ownerId: uDysKhi.id,
      divisionId: khiDiv.id,
      status: 'in_progress',
      priority: 'urgent',
      parentTaskId: tCabinet.id,
      createdById: uDirKhi.id,
    },
  });

  await prisma.task.create({
    data: {
      name: 'Draft v2 — review with JS before circulation',
      ownerId: uDirKhi.id,
      divisionId: khiDiv.id,
      status: 'not_started',
      priority: 'urgent',
      parentTaskId: tCabinet.id,
      createdById: uDirKhi.id,
    },
  });

  // --- JS Priority: week lane ---
  // t-media-launch
  const tMediaLaunch = await prisma.task.create({
    data: {
      name: 'Media campaign rollout — Khelo India launch',
      ownerId: uDirKhi.id,
      divisionId: khiDiv.id,
      status: 'in_progress',
      priority: 'high',
      jsPriorityLane: 'week',
      dueDate: daysFromNow(4),
      milestone: true,
      createdById: osd.id,
    },
  });

  // 8 subtasks on t-media-launch (4 done, 4 not started — not in spec detail, just totals)
  const mediaSubNames = [
    'Draft press release copy',
    'Coordinate with PIB media team',
    'Prepare social media assets',
    'Brief spokesperson',
    'Schedule press conference',
    'Confirm venue and AV setup',
    'Review final press kit',
    'Obtain JS sign-off',
  ];
  for (let i = 0; i < mediaSubNames.length; i++) {
    await prisma.task.create({
      data: {
        name: mediaSubNames[i],
        ownerId: uDirKhi.id,
        divisionId: khiDiv.id,
        status: i < 4 ? 'completed' : 'not_started',
        priority: 'high',
        parentTaskId: tMediaLaunch.id,
        createdById: uDirKhi.id,
      },
    });
  }

  // --- JS Priority: month lane ---
  const tQuarterlyAbReview = await prisma.task.create({
    data: {
      name: 'Quarterly autonomous bodies review meeting',
      ownerId: uDirAb.id,
      divisionId: abDiv.id,
      status: 'not_started',
      priority: 'high',
      jsPriorityLane: 'month',
      dueDate: daysFromNow(20),
      milestone: true,
      createdById: osd.id,
    },
  });

  // --- JS Priority: watchlist lane ---
  const tPmuContractRestructure = await prisma.task.create({
    data: {
      name: 'Restructure Khelo India Mission PMU contract',
      ownerId: osd.id,
      divisionId: khiDiv.id,
      status: 'not_started',
      priority: 'high',
      jsPriorityLane: 'watchlist',
      dueDate: daysFromNow(45),
      milestone: true,
      createdById: osd.id,
    },
  });

  // --- Other open tasks ---

  // t-brief-js: due today at 16:00
  const tBriefJs = await prisma.task.create({
    data: {
      name: 'Brief JS on Asian Games delegation list',
      ownerId: uDysKhi.id,
      divisionId: khiDiv.id,
      status: 'awaiting_input',
      priority: 'high',
      dueDate: todayAt(16, 0),
      createdById: uDirKhi.id,
    },
  });

  // t-mof: linked to TF-2026/34
  const tMof = await prisma.task.create({
    data: {
      name: 'Coordinate MoF inputs for indicative outlay',
      ownerId: uDirAb.id,
      divisionId: abDiv.id,
      status: 'in_progress',
      priority: 'medium',
      dueDate: daysFromNow(1),
      linkedTimelineFileId: tf34.id,
      createdById: osd.id,
    },
  });

  // t-sai-audit
  await prisma.task.create({
    data: {
      name: 'SAI Q3 infrastructure audit report',
      ownerId: uDirAb.id,
      divisionId: abDiv.id,
      status: 'in_progress',
      priority: 'high',
      dueDate: daysFromNow(1),
      createdById: uDirAb.id,
    },
  });

  // t-nada-review: OVERDUE — 3 days ago
  await prisma.task.create({
    data: {
      name: 'Review NADA quarterly compliance report',
      ownerId: uDirAb.id,
      divisionId: abDiv.id,
      status: 'awaiting_input',
      priority: 'medium',
      dueDate: daysAgo(3),
      createdById: uDirAb.id,
    },
  });

  // t-pmu-monthly
  await prisma.task.create({
    data: {
      name: 'Coordinate PMU monthly review — Khelo India',
      ownerId: uDirKhi.id,
      divisionId: khiDiv.id,
      status: 'in_progress',
      priority: 'medium',
      dueDate: daysFromNow(3),
      createdById: uDirKhi.id,
    },
  });

  // t-ncssr-list
  await prisma.task.create({
    data: {
      name: 'NCSSR research project list — update',
      ownerId: uDirAb.id,
      divisionId: abDiv.id,
      status: 'in_progress',
      priority: 'low',
      dueDate: daysFromNow(13),
      createdById: uDirAb.id,
    },
  });

  // t-pib-release
  await prisma.task.create({
    data: {
      name: 'PIB press release — Khelo India sub-component launch',
      ownerId: uDirKhi.id,
      divisionId: khiDiv.id,
      status: 'on_hold',
      priority: 'medium',
      dueDate: daysFromNow(16),
      createdById: uDirKhi.id,
    },
  });

  // t-sai-uniform
  await prisma.task.create({
    data: {
      name: 'Procure athletics team uniforms',
      ownerId: uUsAbPo.id,
      divisionId: abDiv.id,
      status: 'not_started',
      priority: 'medium',
      dueDate: daysFromNow(8),
      createdById: uDirAb.id,
    },
  });

  // t-khi-vendor
  await prisma.task.create({
    data: {
      name: 'Vet PMU vendor empanelment list',
      ownerId: uUsKhi.id,
      divisionId: khiDiv.id,
      status: 'in_progress',
      priority: 'low',
      dueDate: daysFromNow(10),
      createdById: uDirKhi.id,
    },
  });

  // t-osd-own: a task the OSD keeps to themselves by simply not sharing it
  await prisma.task.create({
    data: {
      name: 'Prepare JS briefing notes',
      ownerId: osd.id,
      divisionId: officeOfJs.id,
      status: 'not_started',
      priority: 'low',
      dueDate: daysFromNow(2),
      createdById: osd.id,
    },
  });

  // t-aso-filing
  await prisma.task.create({
    data: {
      name: 'File May returns to DG&CA',
      ownerId: uAsoKhi.id,
      divisionId: khiDiv.id,
      status: 'not_started',
      priority: 'low',
      dueDate: daysFromNow(6),
      createdById: uDirKhi.id,
    },
  });

  // t-pmu-vendor-tracker
  await prisma.task.create({
    data: {
      name: 'KIM PMU — vendor tracker monthly refresh',
      ownerId: pC.id,
      divisionId: khiDiv.id,
      status: 'in_progress',
      priority: 'low',
      dueDate: daysFromNow(5),
      createdById: pTl.id,
    },
  });

  // t-pmu-state-engage
  await prisma.task.create({
    data: {
      name: 'KIM PMU — state engagement plan v3',
      ownerId: pTl.id,
      divisionId: khiDiv.id,
      status: 'awaiting_input',
      priority: 'medium',
      dueDate: daysFromNow(11),
      createdById: pTl.id,
    },
  });

  // t-asian-games: completed, linked to TF-2026/22
  const tAsianGames = await prisma.task.create({
    data: {
      name: 'Finalise Asian Games delegation paperwork',
      ownerId: uDysKhi.id,
      divisionId: khiDiv.id,
      status: 'completed',
      priority: 'high',
      dueDate: new Date('2026-04-30'),
      linkedTimelineFileId: tf22.id,
      createdById: uDirKhi.id,
    },
  });

  // -------------------------------------------------------------------------
  // 7. Task collaborators on t-cabinet
  // -------------------------------------------------------------------------
  console.log('seed-mock: creating task collaborators…');

  await prisma.taskCollaborator.createMany({
    data: [
      { taskId: tCabinet.id, userId: uDysKhi.id, role: 'division_lead', addedById: osd.id },
      { taskId: tCabinet.id, userId: uDirAb.id, role: 'division_lead', addedById: osd.id },
      { taskId: tCabinet.id, userId: osd.id, role: 'collaborator', addedById: osd.id },
      { taskId: tCabinet.id, userId: uUsAbPo.id, role: 'collaborator', addedById: osd.id },
    ],
  });

  // -------------------------------------------------------------------------
  // 8. Task attachments on t-cabinet (3)
  // -------------------------------------------------------------------------
  console.log('seed-mock: creating task attachments…');

  await prisma.attachment.create({
    data: {
      ownerType: 'task',
      ownerId: tCabinet.id,
      fileName: 'cabinet-note-draft-v2.pdf',
      fileUrl: '#',
      mimeType: 'application/pdf',
      source: 'uploaded',
      uploadedById: uDirKhi.id,
      uploadedAt: daysAgo(2),
    },
  });

  await prisma.attachment.create({
    data: {
      ownerType: 'task',
      ownerId: tCabinet.id,
      fileName: 'cost-analysis-mof.pdf',
      fileUrl: '#',
      mimeType: 'application/pdf',
      source: 'uploaded',
      uploadedById: uDysKhi.id,
      uploadedAt: daysAgo(1),
    },
  });

  await prisma.attachment.create({
    data: {
      ownerType: 'task',
      ownerId: tCabinet.id,
      fileName: 'Mission architecture diagram',
      fileUrl: 'https://drive.google.com/mock-link',
      source: 'drive_link',
      uploadedById: uDirAb.id,
      uploadedAt: daysAgo(1),
    },
  });

  // -------------------------------------------------------------------------
  // 9. Comments on t-cabinet (5)
  // -------------------------------------------------------------------------
  console.log('seed-mock: creating task comments…');

  const now = new Date();
  const msAgo = (ms: number) => new Date(now.getTime() - ms);
  const hoursAgo = (h: number) => msAgo(h * 60 * 60 * 1000);

  await prisma.taskComment.create({
    data: {
      taskId: tCabinet.id,
      userId: uDirKhi.id,
      body: 'Draft v2 is ready. @u-dys-khi can you add the cost figures from MoF before EoD? @u-osd sharing for your visibility.',
      mentions: [uDysKhi.id, osd.id],
      createdAt: hoursAgo(5),
    },
  });

  await prisma.taskComment.create({
    data: {
      taskId: tCabinet.id,
      userId: uDysKhi.id,
      body: 'On it. MoF shared their numbers this morning. Will update the draft and share by 5 pm.',
      statusTransition: 'in_progress',
      createdAt: hoursAgo(4),
    },
  });

  await prisma.taskComment.create({
    data: {
      taskId: tCabinet.id,
      userId: osd.id,
      body: 'Added to JS priority — today. @u-dir-khi please ensure JS sees the final before circulation.',
      mentions: [uDirKhi.id],
      createdAt: hoursAgo(3),
    },
  });

  await prisma.taskComment.create({
    data: {
      taskId: tCabinet.id,
      userId: uDirAb.id,
      body: 'SAI inputs incorporated in section 4.2. Diagram uploaded to Drive.',
      createdAt: hoursAgo(2),
    },
  });

  await prisma.taskComment.create({
    data: {
      taskId: tCabinet.id,
      userId: uDirKhi.id,
      body: 'Thanks @u-dir-ab. Final draft will be circulated by 5:30 pm.',
      mentions: [uDirAb.id],
      createdAt: hoursAgo(1),
    },
  });

  // -------------------------------------------------------------------------
  // 10. Activity on t-cabinet (8+ events)
  // -------------------------------------------------------------------------
  console.log('seed-mock: creating task activity…');

  const activityEvents = [
    // Older (5 events shown under "Show older activity")
    {
      actorId: osd.id,
      eventType: 'task_created',
      payload: { taskName: 'Finalise Khelo India Mission cabinet note' },
      createdAt: daysAgo(5),
    },
    {
      actorId: osd.id,
      eventType: 'collaborator_added',
      payload: { userId: uDysKhi.id, role: 'division_lead' },
      createdAt: daysAgo(4),
    },
    {
      actorId: osd.id,
      eventType: 'collaborator_added',
      payload: { userId: uDirAb.id, role: 'division_lead' },
      createdAt: daysAgo(4),
    },
    {
      actorId: uDirKhi.id,
      eventType: 'attachment_uploaded',
      payload: { fileName: 'cabinet-note-draft-v2.pdf' },
      createdAt: daysAgo(2),
    },
    {
      actorId: uDysKhi.id,
      eventType: 'attachment_uploaded',
      payload: { fileName: 'cost-analysis-mof.pdf' },
      createdAt: daysAgo(1),
    },
    // Recent (top 3 visible by default)
    {
      actorId: osd.id,
      eventType: 'js_priority_set',
      payload: { lane: 'today' },
      createdAt: hoursAgo(3),
    },
    {
      actorId: uDirKhi.id,
      eventType: 'milestone_toggled',
      payload: { milestone: true },
      createdAt: hoursAgo(3),
    },
    {
      actorId: osd.id,
      eventType: 'timeline_file_linked',
      payload: { refNo: 'TF-2026/34' },
      createdAt: hoursAgo(6),
    },
  ];

  for (const event of activityEvents) {
    await prisma.taskActivity.create({
      data: {
        taskId: tCabinet.id,
        actorId: event.actorId,
        eventType: event.eventType,
        payload: event.payload,
        createdAt: event.createdAt,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 11. Timeline file task links
  // -------------------------------------------------------------------------
  console.log('seed-mock: creating timeline file task links…');

  // TF-2026/34 links: t-cabinet, t-brief-js, t-mof
  await prisma.timelineFileTaskLink.createMany({
    data: [
      { timelineFileId: tf34.id, taskId: tCabinet.id, linkedById: osd.id },
      { timelineFileId: tf34.id, taskId: tBriefJs.id, linkedById: osd.id },
      { timelineFileId: tf34.id, taskId: tMof.id, linkedById: osd.id },
    ],
  });

  // TF-2026/22 links: t-asian-games
  await prisma.timelineFileTaskLink.create({
    data: { timelineFileId: tf22.id, taskId: tAsianGames.id, linkedById: osd.id },
  });

  // -------------------------------------------------------------------------
  // 12. Timeline file activity
  // -------------------------------------------------------------------------
  console.log('seed-mock: creating timeline file activity…');

  await prisma.timelineFileActivity.createMany({
    data: [
      {
        timelineFileId: tf34.id,
        actorId: osd.id,
        eventType: 'timeline_file_created',
        payload: { refNo: 'TF-2026/34' },
        createdAt: new Date('2026-05-18T10:00:00Z'),
      },
      {
        timelineFileId: tf34.id,
        actorId: osd.id,
        eventType: 'marked_to_division',
        payload: { divisionName: 'Khelo India Division' },
        createdAt: new Date('2026-05-18T10:05:00Z'),
      },
      {
        timelineFileId: tf34.id,
        actorId: osd.id,
        eventType: 'status_changed',
        payload: { from: 'pending_action', to: 'in_progress' },
        createdAt: new Date('2026-05-20T09:00:00Z'),
      },
      {
        timelineFileId: tf34.id,
        actorId: uDirKhi.id,
        eventType: 'task_linked',
        payload: { taskName: 'Finalise Khelo India Mission cabinet note' },
        createdAt: new Date('2026-05-21T11:00:00Z'),
      },
      {
        timelineFileId: tf38.id,
        actorId: osd.id,
        eventType: 'timeline_file_created',
        payload: { refNo: 'TF-2026/38' },
        createdAt: new Date('2026-05-25T14:00:00Z'),
      },
      {
        timelineFileId: tf22.id,
        actorId: osd.id,
        eventType: 'timeline_file_created',
        payload: { refNo: 'TF-2026/22' },
        createdAt: new Date('2026-04-12T09:00:00Z'),
      },
      {
        timelineFileId: tf22.id,
        actorId: osd.id,
        eventType: 'status_changed',
        payload: { from: 'in_progress', to: 'closed' },
        createdAt: new Date('2026-05-01T16:00:00Z'),
      },
    ],
  });

  // -------------------------------------------------------------------------
  // Done
  // -------------------------------------------------------------------------
  console.log('\nseed-mock: complete.');
  console.log('');
  console.log('Verification counts (run these against your DB):');
  console.log('  SELECT COUNT(*) FROM users                                           → expect 10');
  console.log('  SELECT COUNT(*) FROM tasks WHERE archived_at IS NULL                → expect 26 (18 top-level + 8 t-cabinet subtasks + 8 media subtasks ... check spec)');
  console.log('  SELECT COUNT(*) FROM tasks WHERE js_priority_lane IS NOT NULL        → expect 4');
  console.log('  SELECT COUNT(*) FROM tasks WHERE status = \'completed\'               → expect 1 (t-asian-games) + subtasks');
  console.log('  SELECT COUNT(*) FROM tasks WHERE parent_task_id IS NOT NULL         → expect 12 (4 cabinet + 8 media)');
  console.log('  SELECT COUNT(*) FROM timeline_files                                 → expect 3');
  console.log('  SELECT COUNT(*) FROM timeline_file_marked_to                        → expect 4');
  console.log('  SELECT COUNT(*) FROM task_collaborators                             → expect 4');
  console.log('  SELECT COUNT(*) FROM task_comments                                  → expect 5');
  console.log('  SELECT COUNT(*) FROM task_comments WHERE status_transition IS NOT NULL → expect 1');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
