/**
 * Idempotent provisioning for the Business Cards module — imports the contacts
 * captured in the "Business Card Contacts" sheet into `business_cards`, under
 * the two events the sheet is split into ("TOI events" and "Non TOI events").
 *
 *   pnpm db:seed:business-cards
 *
 * Safe to run against any environment, repeatedly — it upserts on
 * (full name + company) and never wipes (unlike the main destructive
 * `seed.ts`). Re-running updates the fields in place, so correcting a row in
 * the source data and re-running is the intended workflow.
 *
 * Field mapping — the sheet carries twelve columns, the `BusinessCard` model
 * eight. Full name, job title, company, industry, email and mobile map one to
 * one. The five columns with no model field (office number, website, address,
 * city, lead category) are folded into `remarks` as a labelled block above the
 * sheet's own Notes text, so nothing from the sheet is lost and everything
 * stays reachable from the browser's global search (which covers remarks).
 *
 * Attachments (the scanned card images) are NOT handled here — they are
 * uploaded through the UI against each contact afterwards.
 *
 * The contacts are attributed to the oldest active Super Admin (`created_by`),
 * since a seed has no session user. That only affects the "Added by" label and
 * the creator-or-Super-Admin delete rule; every user with Business Cards access
 * sees every card regardless.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** The two sheet tabs become the two event names. */
const TOI_EVENT = 'TOI events';
const NON_TOI_EVENT = 'Non TOI events';

/**
 * One row of the source sheet, verbatim. Blank cells are omitted rather than
 * filled in — where the sheet deliberately left a value out, so does this file.
 */
type SheetRow = {
  fullName: string;
  jobTitle?: string;
  company: string;
  industry?: string;
  email?: string;
  mobile?: string;
  officeNumber?: string;
  website?: string;
  address?: string;
  city?: string;
  leadCategory?: string;
  notes?: string;
  event: string;
};

const ROWS: SheetRow[] = [
  // ---------------------------------------------------------------------
  // Sheet 1 — "TOI EVENT Contacts" (Business Card Contacts, Sports Industry Expo)
  // ---------------------------------------------------------------------
  {
    fullName: 'Neeraj Jha',
    jobTitle: 'Business Head - Eurosport',
    company: 'Discovery Communications India (Warner Bros. Discovery)',
    industry: 'Sports Broadcasting & Media',
    email: 'neeraj.jha@wbd.com',
    mobile: '+91 98111 46686',
    address: 'Building No. 9A, 9th Floor, DLF Cyber City',
    city: 'Gurugram',
    leadCategory: 'Media',
    notes:
      'Runs the Eurosport business in India under Warner Bros. Discovery - the single most direct route into sports broadcast rights, on-air sponsorship inventory and event media partnerships. Highest-value contact from this expo.',
    event: TOI_EVENT,
  },
  {
    fullName: 'Dhanush Vir Singh',
    jobTitle: 'Vice President - Corporate Affairs & Govt Relations',
    company: 'Bennett, Coleman & Co. Ltd. (The Times of India)',
    industry: 'Media & Publishing',
    email: 'dhanush.singh@timesofindia.com',
    mobile: '+91 97935 00555',
    address:
      'Payagpur Tower, 38/22, Meerabai Marg, Lucknow - 226 001; also 9-10, Bahadur Shah Zafar Marg, New Delhi - 110 002',
    city: 'Lucknow',
    leadCategory: 'Media',
    notes:
      "VP at India's largest media group, sitting at the intersection of press and government relations. Dual-door contact: editorial/coverage reach plus policy access. BCCL also owns large event and sponsorship properties.",
    event: TOI_EVENT,
  },
  {
    fullName: 'Vinay Datta',
    jobTitle: 'Vice-President Operations',
    company: 'Amity University Online',
    industry: 'Education / Higher Education',
    email: 'vdatta@amity.edu',
    mobile: '+91 93124 31599',
    officeNumber: '+91 120 458 6883',
    address: 'F-2 Block, 2nd Floor, Amity University Campus, Sector-125',
    city: 'Noida',
    leadCategory: 'Education',
    notes:
      'Budget-holding decision maker for online operations at a very large private university. Route to campus sports programmes, student-facing sponsorship and education partnerships. Ashish Pratap Singh (same org) is the working-level entry point.',
    event: TOI_EVENT,
  },
  {
    fullName: 'Gauri Kalra',
    jobTitle: 'Education Specialist - Public Diplomacy Section',
    company: 'Embassy of the United States of America',
    industry: 'Government / Diplomatic Mission',
    email: 'KalraG@state.gov',
    mobile: '+91 98717 04362',
    officeNumber: '+91 11 2347 2123',
    address: 'The American Center, 24, Kasturba Gandhi Marg',
    city: 'New Delhi',
    leadCategory: 'Government',
    notes:
      "Public Diplomacy education portfolio at the US Embassy - gateway to US-India exchange programmes, grants and institutional (non-commercial) partnerships. Specialist grade sits above the Outreach Coordinator role. Priority set High per the 'Government official' rule.",
    event: TOI_EVENT,
  },
  {
    fullName: 'Sonal Kapoor Abbey',
    jobTitle: 'Education Outreach Coordinator - Public Diplomacy Section',
    company: 'Embassy of the United States of America',
    industry: 'Government / Diplomatic Mission',
    email: 'AbbeySK@state.gov',
    mobile: '+91 92053 36876',
    officeNumber: '+91 11 2347 2124',
    address: 'The American Center, 24, Kasturba Gandhi Marg',
    city: 'New Delhi',
    leadCategory: 'Government',
    notes:
      "Same Public Diplomacy channel as Gauri Kalra, one rung lower - the right contact for programme-level execution and outreach logistics. Coordinator title would normally read Low; scored High per the 'Government official' rule.",
    event: TOI_EVENT,
  },
  {
    fullName: 'Ashish Pratap Singh',
    jobTitle: 'Assistant General Manager',
    company: 'Amity University Online',
    industry: 'Education / Higher Education',
    email: 'apsingh17@amity.edu',
    mobile: '+91 93192 95207',
    address: 'F-2 Block, 2nd Floor, Amity University Campus, Sector-125',
    city: 'Noida',
    leadCategory: 'Education',
    notes:
      'Manager-grade operator at Amity Online. Not the decision maker, but the person who moves proposals internally - best used as the warm path to Vinay Datta rather than a standalone lead.',
    event: TOI_EVENT,
  },
  {
    fullName: 'Dyanesh Randad',
    jobTitle: 'Head - Institutional Sales',
    company: 'Medevice Healthtech',
    industry: 'Healthcare / Medical Devices',
    email: 'sales@medevice.co',
    mobile: '+91 94231 41111',
    officeNumber: '+91 75881 34567',
    website: 'medevice.co',
    address: 'Office No. 6, 3rd Floor, Vidya Building, DP Road, Aundh',
    city: 'Pune',
    leadCategory: 'Healthcare',
    notes:
      "Heads institutional sales for a medical device firm. Outside the core sports/media/education focus, but a natural fit for sports-medicine tie-ins, team healthcare tenders and event medical partnerships. Card also lists a general inbox (info@medevice.co) and the tagline 'Trust | Technology | Innovation'. Note: the card labels neither number - the mobile/office split is read from the person vs handset icons, and both prefixes are Indian mobile series, so 75881 34567 is a second mobile rather than a Pune landline.",
    event: TOI_EVENT,
  },

  // ---------------------------------------------------------------------
  // Sheet 2 — "NON TOI EVENTS"
  // ---------------------------------------------------------------------
  {
    fullName: 'Azlina Sulaiman',
    jobTitle: 'VP, Government & Public Affairs - Asia Pacific Latin America (APLA)',
    company: 'Nike Global Trading B.V. - Singapore Branch',
    industry: 'Sportswear & Athletic Apparel',
    email: 'azlina.sulaiman@nike.com',
    mobile: '+65 9858 2705',
    officeNumber: '+65 6788 0990',
    address: '30 Pasir Panjang Road, Mapletree Business City, #10-31/32',
    city: 'Singapore',
    leadCategory: 'Sponsorship',
    notes:
      'Regional VP covering government and public affairs across Asia Pacific and Latin America - the most senior contact in this batch, and her remit spans India. Pairs directly with Udai Singh Mehta (Nike India Director) below: approach at both regional and country level rather than either alone. Card prints name, title and email in caps; HP is the mobile, TEL the Singapore office line. No website printed on either side.',
    event: NON_TOI_EVENT,
  },
  {
    fullName: 'Udai Singh Mehta',
    jobTitle: 'Director - Government & Public Affairs, India',
    company: 'Nike India Pvt Ltd.',
    industry: 'Sportswear & Athletic Apparel',
    email: 'udaisingh.mehta@nike.com',
    mobile: '+91 98292 85926',
    website: 'www.nike.com',
    address: '1st Floor, Olympia Building, No. 66/1, Bagmane Tech Park, CV Raman Nagar',
    city: 'Bangalore',
    leadCategory: 'Sponsorship',
    notes:
      "The anchor sponsorship brand in Indian sport, and his remit is government and public affairs - the exact intersection of sponsorship and policy. The India-level counterpart to Azlina Sulaiman above. Card front lists his own base as Gurugram; the Bangalore address is Nike India's registered office printed on the reverse. Website is printed on the card in caps as WWW.NIKE.COM.",
    event: NON_TOI_EVENT,
  },
  {
    fullName: 'Rajiv K. Sharma',
    jobTitle: 'Director',
    company: 'Advanced Sport Technologies LLP (AST)',
    industry: 'Sports Infrastructure & Surfacing',
    email: 'info@ast-sports.com',
    mobile: '+91 98114 82226',
    officeNumber: '+91 11 4165 0045',
    website: 'www.ast-sports.com',
    address: 'E-42, 3rd Floor, Okhla Industrial Area, Phase II',
    city: 'New Delhi',
    leadCategory: 'Sports',
    notes:
      'Director at the India partner for Polytan, the German sports-surface manufacturer - synthetic turf, athletics tracks and stadium surfacing. Strong fit for venue build-outs and federation tenders. Note: the printed email is the company inbox, not a personal address.',
    event: NON_TOI_EVENT,
  },
  {
    fullName: 'Veerendrakumar Rawat',
    jobTitle: 'Founder',
    company: 'VKR Tennis Academy (Khelo India Accredited Academy)',
    industry: 'Sports Academy / Tennis Coaching',
    email: 'partnerships@vkrtennis.com',
    mobile: '+91 98257 81077 / +91 98986 71077',
    website: 'www.vkrtennis.com',
    address: 'Operating at Major Dhyan Chand National Stadium, India Gate Cir, India Gate',
    city: 'New Delhi',
    leadCategory: 'Sports',
    notes:
      'Founder of a Khelo India accredited academy operating out of Major Dhyan Chand National Stadium - grassroots talent pipeline plus a government accreditation link. Card carries a dedicated partnerships@ address, so he is actively seeking partners. Same individual as the SRAG Ahmedabad row below. Also lists vkrtennis01@gmail.com and Instagram @vkr_tennis_academy. Both numbers appear under one WhatsApp icon; neither is a landline.',
    event: NON_TOI_EVENT,
  },
  {
    fullName: 'Veerendrakumar Rawat',
    jobTitle: 'Hon. Secretory & Director',
    company: 'SRAG Tennis Academy (Khelo India Accredited Academy)',
    industry: 'Sports Academy / Tennis Coaching',
    email: 'partnerships@sragtennis.com',
    mobile: '+91 98257 81077 / +91 93165 61675',
    website: 'www.sragtennis.com',
    address: 'Nr. Rajvi Tower, Gurukul Road, Memnagar',
    city: 'Ahmedabad',
    leadCategory: 'Sports',
    notes:
      "Second card from the same person, covering his Ahmedabad academy - so he offers a two-city (Delhi + Gujarat) footprint from a single relationship. Title is printed as 'Secretory' on the card (the card's own spelling, kept verbatim). Also lists sragacademy@gmail.com and Instagram @srag_tennis_academy. The 98257 81077 mobile is shared with the VKR card.",
    event: NON_TOI_EVENT,
  },
  {
    fullName: 'Ramesh Tibrewal',
    jobTitle: 'Director',
    company: 'Deloitte Touche Tohmatsu India LLP',
    industry: 'Professional Services / Consulting',
    email: 'rtibrewal@deloitte.com',
    mobile: '+91 97164 31218',
    officeNumber: '+91 124 679 2000',
    website: 'www.deloitte.com',
    address: '7th Floor, Building 10, Tower B, DLF Cyber City Complex, DLF City Phase II',
    city: 'Gurugram',
    leadCategory: 'Other',
    notes:
      'Big Four director - valuable indirectly, as a route to client introductions, sector research and deal advisory rather than as a partner in his own right. Card also prints a fax line, +91 124 679 2012.',
    event: NON_TOI_EVENT,
  },
  {
    fullName: 'Deval Sood',
    jobTitle: 'AVP - Regulatory',
    company: 'Bharti Airtel Ltd.',
    industry: 'Telecommunications',
    email: 'deval.sood@airtel.com',
    mobile: '+91 98102 89989',
    website: 'www.airtel.com',
    address: 'Plot No. 16, Udyog Vihar, Phase IV',
    city: 'Gurugram',
    leadCategory: 'Technology',
    notes:
      "Regulatory and policy remit at India's largest telecom operator; card names the India & South Asia unit. Relevant where streaming, broadcast carriage or spectrum policy touches sports rights. Priority note: AVP sits between the stated Medium (manager) and High (VP) bands - scored Medium because AVP is not a full VP.",
    event: NON_TOI_EVENT,
  },
  {
    fullName: 'Mohd Mannan Siddiqui',
    jobTitle: 'Manager (North India) - Technical Solutions & Sales',
    company: 'Myrtha Pools India Private Limited',
    industry: 'Sports Infrastructure / Aquatic Facilities',
    email: 'mohd.siddiqui@myrthapools.in',
    mobile: '+91 63667 65794',
    website: 'www.myrthapools.com',
    address: 'Unit No. 411, 4th Floor, DLF Tower B, Jasola District Centre',
    city: 'New Delhi',
    leadCategory: 'Sports',
    notes:
      'Myrtha builds competition swimming pools and is an A&T Europe S.p.A (Italy) company. Manager-grade and regional, but the right technical contact for aquatic venue projects. Company inbox info@myrthapools.in also printed on the card front.',
    event: NON_TOI_EVENT,
  },
  {
    fullName: 'Mihir Kumar Dash',
    jobTitle: 'Director',
    company: 'Business Intelligence Professionals Pvt. Ltd. (BIPROS)',
    industry: 'Business Intelligence & Analytics / IT Services',
    email: 'mihir@bipros.com',
    mobile: '+91 94374 77499 / +91 99374 99198 / +1 919 300 5197 (US)',
    website: 'www.bipros.com',
    address:
      'Unit 801-04, DLF Cybercity, Patia, Bhubaneswar-751024 (India). US office on the reverse: 5011 Southpark Dr, Suite 210, Durham, NC 27713',
    city: 'Bhubaneswar',
    leadCategory: 'Technology',
    notes:
      "Director at a business-intelligence and analytics services firm running India (Bhubaneswar) and US (Durham, NC) offices. Outside the core sports / media / education focus - relevant only if you need data, analytics or dashboard capability behind a project. All three numbers are printed as mobile lines (the card labels the US one 'M:'), so none is recorded as an office number.",
    event: NON_TOI_EVENT,
  },
  {
    fullName: 'Sandeep Garg',
    jobTitle: 'CEO',
    // The sheet leaves Company and Industry blank: no company name is printed
    // on the card, only logos. "Landsmill Solar" is read from the ceo@
    // landsmillsolar.com email domain — recorded on instruction, and flagged as
    // an inference in the remarks below rather than presented as printed fact.
    company: 'Landsmill Solar',
    email: 'ceo@landsmillsolar.com',
    mobile: '+91 98102 91503',
    address: '1510-1511, Chiranjiv Tower, Nehru Place',
    city: 'New Delhi',
    leadCategory: 'Other',
    notes:
      "CEO-level, so worth keeping, but the least connected to the sports/media/education/sponsorship focus. IMPORTANT: no company name is printed anywhere on this card - only logos - so the sheet leaves Company and Industry blank. The company recorded here, Landsmill Solar, is inferred from the ceo@landsmillsolar.com email domain, which points to a solar-energy business; it is inference from the domain, not printed fact. Industry is left blank for the same reason. Name is printed as 'Dr Sandeep Garg'; the Dr honorific is dropped from the Full name field.",
    event: NON_TOI_EVENT,
  },
];

/**
 * Fold the five sheet columns the model has no field for into a labelled block
 * above the sheet's Notes text. Omits any line the sheet left blank.
 */
function buildRemarks(row: SheetRow): string | null {
  const lines: string[] = [];
  if (row.officeNumber) lines.push(`Office number: ${row.officeNumber}`);
  if (row.website) lines.push(`Website: ${row.website}`);
  if (row.address) lines.push(`Address: ${row.address}`);
  if (row.city) lines.push(`City: ${row.city}`);
  if (row.leadCategory) lines.push(`Lead category: ${row.leadCategory}`);

  const block = lines.join('\n');
  const remarks = [block, row.notes].filter(Boolean).join('\n\n');
  return remarks.length > 0 ? remarks : null;
}

async function main() {
  // A seed has no session user, so attribute the contacts to the oldest active
  // Super Admin. Fails loudly rather than inventing an account.
  const author = await prisma.user.findFirst({
    where: { isSuperAdmin: true, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, username: true },
  });
  if (!author) {
    throw new Error(
      'No active Super Admin found to attribute the contacts to. Provision users before running this seed.',
    );
  }
  console.log(`Attributing contacts to Super Admin "${author.username}".`);

  // 1) The two events (idempotent by their unique name).
  const eventIds = new Map<string, string>();
  for (const name of [TOI_EVENT, NON_TOI_EVENT]) {
    const event = await prisma.businessCardEvent.upsert({
      where: { name },
      create: { name, createdById: author.id },
      update: {},
      select: { id: true },
    });
    eventIds.set(name, event.id);
    console.log(`Ensured event "${name}" (${event.id}).`);
  }

  // 2) The contacts. `business_cards` has no unique constraint, so the identity
  //    used for idempotency is (full name + company) — unique across the sheet,
  //    including the two cards from Veerendrakumar Rawat, which differ by
  //    academy. Re-running updates the row in place instead of duplicating it.
  let created = 0;
  let updated = 0;
  for (const row of ROWS) {
    const data = {
      fullName: row.fullName,
      jobTitle: row.jobTitle ?? null,
      company: row.company,
      industry: row.industry ?? null,
      email: row.email ?? null,
      mobile: row.mobile ?? null,
      remarks: buildRemarks(row),
      eventId: eventIds.get(row.event) ?? null,
    };

    const existing = await prisma.businessCard.findFirst({
      where: { fullName: row.fullName, company: row.company },
      select: { id: true },
    });

    if (existing) {
      await prisma.businessCard.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.businessCard.create({ data: { ...data, createdById: author.id } });
      created += 1;
    }
  }

  console.log(`Business card contacts: ${created} created, ${updated} updated (${ROWS.length} rows).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
