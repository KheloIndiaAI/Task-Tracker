/**
 * MYAS Task Tracker — Seed tasks from the PDF task tracker
 *
 * 1. Cleans all existing tasks, timeline files, and related data
 * 2. Creates new divisions (NSDF, SGM, Media & IT, HMYAS, KIM sub-division)
 * 3. Creates Director-level users for each new division
 * 4. Seeds all ~93 tasks from the PDF across correct divisions with proper owners
 *
 * Run with:
 *   npx tsx prisma/seed-pdf-tasks.ts
 */

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = 'Test1234!';

// ---------------------------------------------------------------------------
// Clean
// ---------------------------------------------------------------------------

async function clean() {
  console.log('Cleaning existing tasks and timeline files…');
  await prisma.timelineFileActivity.deleteMany();
  await prisma.timelineFileTaskLink.deleteMany();
  await prisma.timelineFileMarkedTo.deleteMany();
  await prisma.taskActivity.deleteMany();
  await prisma.taskComment.deleteMany();
  await prisma.taskCollaborator.deleteMany();
  await prisma.taskTag.deleteMany();
  await prisma.reassignmentRequest.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.timelineFile.updateMany({
    where: { actionDocumentAttachmentId: { not: null } },
    data: { actionDocumentAttachmentId: null },
  });
  await prisma.attachment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.timelineFile.deleteMany();
  console.log('Clean complete.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findOrCreateDivision(
  name: string,
  kind: string,
  colour: string,
  order: number,
  createdById: string,
  parentId?: string,
) {
  const existing = await prisma.division.findFirst({ where: { name } });
  if (existing) return existing;
  // Every division sits in an organization (2026-09-21): a new division with
  // no parent given joins Ministry Headquarter when the database has it.
  const hq =
    kind === 'division' && !parentId
      ? await prisma.division.findFirst({
          where: { kind: 'organization', name: 'Ministry Headquarter' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      : null;
  return prisma.division.create({
    data: {
      name,
      kind: kind as 'division' | 'sub_division',
      avatarColour: colour,
      hasPmu: false,
      displayOrder: order,
      createdById,
      parentId: parentId ?? hq?.id,
    },
  });
}

async function findOrCreateUser(
  name: string,
  username: string,
  designation: string,
  hierarchySlot: 'js' | 'osd' | 'director' | 'deputy_secretary' | 'under_secretary' | 'section_officer' | 'aso',
  divisionId: string,
  createdById: string,
  passwordHash: string,
  opts?: { supervisorId?: string; isPmu?: boolean; pmuRole?: string },
) {
  const existing = await prisma.user.findFirst({ where: { username } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      name,
      username,
      passwordHash,
      designation,
      hierarchySlot,
      divisionId,
      isActive: true,
      isSuperAdmin: false,
      forcePasswordChange: true,
      createdById,
      supervisorId: opts?.supervisorId,
      isPmu: opts?.isPmu ?? false,
      pmuRole: opts?.pmuRole as any,
    },
  });
}

function createTask(
  name: string,
  divisionId: string,
  ownerId: string,
  createdById: string,
  priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium',
) {
  return prisma.task.create({
    data: {
      name,
      divisionId,
      ownerId,
      createdById,
      status: 'not_started',
      priority,
      visibility: 'division',
    },
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await clean();

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  // Look up bootstrap data
  const osd = await prisma.user.findFirst({ where: { isSuperAdmin: true } });
  if (!osd) throw new Error('Bootstrap super admin not found. Run prisma/seed.ts first.');

  const officeOfJs = await prisma.division.findFirst({ where: { name: 'Office of JS' } });
  if (!officeOfJs) throw new Error('"Office of JS" not found.');

  // Look up existing divisions
  const khiDiv = await prisma.division.findFirst({ where: { name: 'Khelo India Division' } });
  if (!khiDiv) throw new Error('"Khelo India Division" not found.');

  const abDiv = await prisma.division.findFirst({ where: { name: 'Autonomous Bodies' } });
  if (!abDiv) throw new Error('"Autonomous Bodies" not found.');

  // Look up or use existing users
  const uDirKhi = await prisma.user.findFirst({ where: { username: 'ravi.kumar' } });
  const uDysKhi = await prisma.user.findFirst({ where: { username: 'suresh.s' } });
  const uDirAb = await prisma.user.findFirst({ where: { username: 'anita.m' } });
  const pTl = await prisma.user.findFirst({ where: { username: 'karan.v' } });

  // Owners for existing divisions (fallback to OSD only for truly OSD-scoped tasks)
  const khiOwner = uDirKhi?.id ?? osd.id;
  const khiDys = uDysKhi?.id ?? osd.id;
  const abOwner = uDirAb?.id ?? osd.id;
  const pmuOwner = pTl?.id ?? osd.id;

  // -------------------------------------------------------------------------
  // Create new divisions
  // -------------------------------------------------------------------------
  console.log('Creating new divisions…');

  const kimDiv = await findOrCreateDivision(
    'KIM', 'sub_division', '#6d28d9', 1, osd.id, khiDiv.id,
  );

  const nsdfDiv = await findOrCreateDivision(
    'NSDF', 'division', '#0e7490', 3, osd.id,
  );

  const sgmDiv = await findOrCreateDivision(
    'SGM', 'division', '#b91c1c', 4, osd.id,
  );

  const mediaDiv = await findOrCreateDivision(
    'Media & IT', 'division', '#0369a1', 5, osd.id,
  );

  const hmaysDiv = await findOrCreateDivision(
    'HMYAS', 'division', '#854d0e', 6, osd.id,
  );

  // -------------------------------------------------------------------------
  // Create users for new divisions
  // -------------------------------------------------------------------------
  console.log('Creating users for new divisions…');

  const uDirNsdf = await findOrCreateUser(
    'Priya Sharma', 'priya.sharma', 'Director, NSDF',
    'director', nsdfDiv.id, osd.id, passwordHash,
    { supervisorId: osd.id },
  );

  const uDirSgm = await findOrCreateUser(
    'Amit Verma', 'amit.verma', 'Director, SGM',
    'director', sgmDiv.id, osd.id, passwordHash,
    { supervisorId: osd.id },
  );

  const uDirMedia = await findOrCreateUser(
    'Neha Gupta', 'neha.gupta', 'Director, Media & IT',
    'director', mediaDiv.id, osd.id, passwordHash,
    { supervisorId: osd.id },
  );

  const uDirHmays = await findOrCreateUser(
    'Vikram Singh', 'vikram.singh', 'Director, HMYAS',
    'director', hmaysDiv.id, osd.id, passwordHash,
    { supervisorId: osd.id },
  );

  // Deputy Secretary for OSD office tasks
  const uDsOsd = await findOrCreateUser(
    'Sanjay Mehra', 'sanjay.mehra', 'Deputy Secretary, Office of JS',
    'deputy_secretary', officeOfJs.id, osd.id, passwordHash,
    { supervisorId: osd.id },
  );

  // -------------------------------------------------------------------------
  // Khelo India Division tasks (14)
  // -------------------------------------------------------------------------
  console.log('Seeding Khelo India Division tasks…');

  const khiTasks = [
    'CS conference action points',
    'Follow up on Annual action plan',
    'Chintan Shivir — Action points and minutes',
    'Weekly & Monthly Budget Expenditure tracking',
    'Chintan shivir — functional groups debrief',
    'KI — work allocation — internal division review',
    'KI Section — Administrative strengthening',
    'COE Manesar',
    'JLN TA Status',
    'PM Gatishakti progress review',
    'JWG on Live Concerts',
    'Vibrant Villages Programme',
    'Digitizing DPAC procedure',
    'Football Academy — Churchandpur',
  ];

  for (const name of khiTasks) {
    await createTask(name, khiDiv.id, khiOwner, osd.id);
  }

  // -------------------------------------------------------------------------
  // KIM tasks (17)
  // -------------------------------------------------------------------------
  console.log('Seeding KIM tasks…');

  const kimTasks = [
    'Cabinet note on KIM',
    'Op Guidelines Review',
    'Detailed brainstorming on existing athletes transition to KIA/E-KIA',
    'School Leagues Plan',
    'Website for KIM',
    'BCCI Deck',
    'Digitization of fund flow and disbursement',
    'ITBP Follow up — Sports climbing',
    'ASI & AEN, ARN Infra requirements follow up',
    'KIM orientation sessions to RDs & Officers at RCs',
    'NESTS — MoTA — Centres of Excellence',
    'List all stakeholders for each sub component and consult them on guidelines',
    'Prepare list of Army/Sainik schools/PSU schools etc for KIFS',
    'Estimate Committee Minute',
    'Tracking of WEK / MEP',
    'Ice Skiing Committee',
    'Army Sports Institute Infra',
  ];

  for (const name of kimTasks) {
    await createTask(name, kimDiv.id, khiOwner, osd.id);
  }

  // -------------------------------------------------------------------------
  // KI-EY-PMU tasks (19)
  // -------------------------------------------------------------------------
  console.log('Seeding KI-EY-PMU tasks…');

  const kimPmu = await prisma.division.findFirst({ where: { name: 'KIM PMU' } });
  const pmuDivId = kimPmu?.id ?? khiDiv.id;

  const pmuTasks = [
    'Swimming Deck',
    'Presentation on Railways & Defence',
    'Academy Culture — Concept note',
    'Boxing Talent Cluster Framework',
    'Subordinate legislation on Anti Doping amendment act',
    'Criminalisation of Doping Law',
    'Tracker mapping EFC Comments + Chintan Shivir + CS conference + PMO directions',
    'Talent Committees',
    'PMU Seating plan',
    'Internship Deployment review',
    'AICS review',
    'NCAB — Follow up on minutes of meeting',
    'KSSR land use — Ridge area',
    'Setting up of Lab at NFSU',
    'Study of Akhada Culture — funded through NSDF',
    'Secretary SAI',
    'Sports Event Management Companies Policy Framework',
    'NDTF Tariff Policy',
    'ANRF follow up',
  ];

  for (const name of pmuTasks) {
    await createTask(name, pmuDivId, pmuOwner, osd.id);
  }

  // -------------------------------------------------------------------------
  // AB Division tasks (7)
  // -------------------------------------------------------------------------
  console.log('Seeding AB Division tasks…');

  const abTasks = [
    'OTC Koteshwar',
    'OTC Hockey',
    'NISSR CEE Update',
    'PMU — Deployment, Letter of award, Agreement signing',
    'RC Bengaluru — 100 Acres Land',
    'Council Meetings Every 2 months',
    'PMU to prepare presentation on extending handholding assistance to academies',
  ];

  for (const name of abTasks) {
    await createTask(name, abDiv.id, abOwner, osd.id);
  }

  // -------------------------------------------------------------------------
  // NSDF tasks (11) — owned by Director NSDF
  // -------------------------------------------------------------------------
  console.log('Seeding NSDF tasks…');

  const nsdfTasks = [
    'HATC — Shillong — DPR',
    'HATC Land at Awantipoora — Srinagar',
    'NSDF EFC Minutes',
    '2025-26 Annual Report',
    'NCL — CSR Followup',
    'ONGC — CSR assistance to Volleyball',
    'NSDF Including in Schedule VII',
    'Mirabhai academy — Manipur',
    'CEO/COO positions',
    'Follow up with NSE',
    'HATC — Ooty land',
  ];

  for (const name of nsdfTasks) {
    await createTask(name, nsdfDiv.id, uDirNsdf.id, osd.id);
  }

  // -------------------------------------------------------------------------
  // SGM tasks (7) — owned by Director SGM
  // -------------------------------------------------------------------------
  console.log('Seeding SGM tasks…');

  const sgmTasks = [
    'EFC Meeting — Comments from Various ministries',
    'Concept note on Sports goods exhibition',
    'Update on communication with ISPO',
    'Follow up with UP & PB based on Letters written by Secy sports',
    'DRI Summons — Duty free imports',
    'Administrative strengthening of the division (SGM)',
    'Meeting with UP invest CEO',
  ];

  for (const name of sgmTasks) {
    await createTask(name, sgmDiv.id, uDirSgm.id, osd.id);
  }

  // -------------------------------------------------------------------------
  // Media & IT tasks (5) — owned by Director Media & IT
  // -------------------------------------------------------------------------
  console.log('Seeding Media & IT tasks…');

  const mediaTasks = [
    'Photography & videography of all SAI, Academies etc',
    'Coffee table book on Chintan Shivir',
    'Schedule EFC Presentation to Laksha FED',
    'Visit to Narella Stadium — Greeco roman wrestling',
    'Visit to Pratap School of Sports',
  ];

  for (const name of mediaTasks) {
    await createTask(name, mediaDiv.id, uDirMedia.id, osd.id);
  }

  // -------------------------------------------------------------------------
  // OSD tasks (8) — owned by Deputy Secretary in Office of JS
  // -------------------------------------------------------------------------
  console.log('Seeding OSD tasks…');

  const osdTasks = [
    'Schedule Meeting with Yashoda Raj Scindia',
    'Meeting with Sports Vot Broadcaster',
    'Administrative strengthening of the division (OSD)',
    'Meeting with Akanksha singh — Basketball',
    'Meeting with Gymnastic coaches',
    'Meetings with TOPS athletes',
    'Pantry & Office staff capacity building for Refreshments and Snacks',
    'Glass water bottles',
  ];

  for (const name of osdTasks) {
    await createTask(name, officeOfJs.id, uDsOsd.id, osd.id);
  }

  // -------------------------------------------------------------------------
  // HMYAS tasks (3) — owned by Director HMYAS
  // -------------------------------------------------------------------------
  console.log('Seeding HMYAS tasks…');

  const hmaysTasks = [
    'Buddh International Circuit',
    'JLN Sports City',
    'Academy Culture Leagues',
  ];

  for (const name of hmaysTasks) {
    await createTask(name, hmaysDiv.id, uDirHmays.id, osd.id);
  }

  // -------------------------------------------------------------------------
  // Other tasks (2) — owned by Deputy Secretary in Office of JS
  // -------------------------------------------------------------------------
  console.log('Seeding Other tasks…');

  await createTask('Manikandan Coach — Odisha to Tamilnadu', officeOfJs.id, uDsOsd.id, osd.id);
  await createTask('International Yogasana Centre — Puri', officeOfJs.id, uDsOsd.id, osd.id);

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const totalTasks = await prisma.task.count();
  const totalDivisions = await prisma.division.count();
  const totalUsers = await prisma.user.count();
  console.log('');
  console.log(`Seed complete: ${totalTasks} tasks across ${totalDivisions} divisions with ${totalUsers} users.`);
  console.log('');
  console.log('New user accounts (password: Test1234!):');
  console.log('  priya.sharma  — Director, NSDF');
  console.log('  amit.verma    — Director, SGM');
  console.log('  neha.gupta    — Director, Media & IT');
  console.log('  vikram.singh  — Director, HMYAS');
  console.log('  sanjay.mehra  — Deputy Secretary, Office of JS');
  console.log('');
  console.log('Existing users from mock seed (password: Test1234!):');
  console.log('  ravi.kumar    — Director, Khelo India Division');
  console.log('  anita.m       — Director, Autonomous Bodies');
  console.log('  karan.v       — Team Leader, KIM PMU');
  console.log('');
  console.log('Each Director sees ONLY their division\'s tasks.');
  console.log('OSD/Super Admin sees all division-visible tasks (by design).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
