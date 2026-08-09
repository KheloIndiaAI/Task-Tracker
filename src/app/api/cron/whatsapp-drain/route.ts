import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { buildNotificationTaskContext } from '@/lib/notification-context';
import { toWhatsAppNumber } from '@/lib/whatsapp/phone';
import { sendWhatsAppTemplate } from '@/lib/whatsapp/sandesha';
import {
  mapNotificationToTemplate,
  WHATSAPP_NOTIFICATION_TYPES,
  type TemplateContext,
} from '@/lib/whatsapp/templates';

/**
 * GET /api/cron/whatsapp-drain
 *
 * Delivers recent in-app notifications to WhatsApp as approved template
 * messages, for users who are opted in (default) and have a phone number.
 *
 * Design: this POLLS the notifications table rather than hooking every
 * `notification.createMany` call site. A notification_delivery row (unique on
 * (notification_id, channel)) both dedupes and records status, so a re-run
 * never double-sends and a 504 is never blindly retried.
 *
 * Meant to run every minute (external scheduler), same CRON_SECRET auth as
 * /api/cron/due-notifications. Gated off unless WHATSAPP_ENABLED === 'true'.
 *
 * Throttle: Sandesha default limit is 60 msg/min per workspace. We cap sends
 * per run (WHATSAPP_MAX_PER_RUN, default 50) so a per-minute schedule stays
 * under the limit. Unsent rows are picked up on the next run.
 */

const LOOKBACK_MS = 15 * 60 * 1000; // only recent notifications; avoids blasting history on first deploy

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  const provided = request.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (process.env.WHATSAPP_ENABLED !== 'true') {
    return NextResponse.json({ skipped: 'disabled' });
  }

  const maxPerRun = Math.min(Number(process.env.WHATSAPP_MAX_PER_RUN) || 50, 55);
  const since = new Date(Date.now() - LOOKBACK_MS);

  // Candidates: recent, WhatsApp-mappable, to an active opted-in user with a
  // phone, and not yet attempted on the WhatsApp channel.
  const candidates = await prisma.notification.findMany({
    where: {
      type: { in: [...WHATSAPP_NOTIFICATION_TYPES] },
      createdAt: { gte: since },
      deliveries: { none: { channel: 'whatsapp' } },
      user: { isActive: true, whatsappOptIn: true, phone: { not: null } },
    },
    select: {
      id: true,
      type: true,
      payload: true,
      user: { select: { phone: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: maxPerRun,
  });

  if (candidates.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, skipped: 0, unknown: 0, considered: 0 });
  }

  // Resolve task context (title / due date / actor name) in one batched pass,
  // reusing the same helper the bell uses so names/dates match.
  const taskCtx = await buildNotificationTaskContext(
    candidates.map((c) => ({ id: c.id, type: c.type, payload: c.payload })),
  );

  // Resolve Timeline-File ref/subject for TF notifications whose payload may not
  // carry them (e.g. timeline_file_marked_to_division).
  const tfIds = new Set<string>();
  for (const c of candidates) {
    const p = (c.payload ?? {}) as Record<string, unknown>;
    if (typeof p.timelineFileId === 'string') tfIds.add(p.timelineFileId);
  }
  const tfRows = tfIds.size
    ? await prisma.timelineFile.findMany({
        where: { id: { in: [...tfIds] } },
        select: { id: true, refNo: true, subject: true },
      })
    : [];
  const tfById = new Map(tfRows.map((t) => [t.id, t]));

  const counts = { sent: 0, failed: 0, skipped: 0, unknown: 0, considered: candidates.length };

  for (const c of candidates) {
    const payload = (c.payload ?? {}) as Record<string, unknown>;

    // Claim this notification for the WhatsApp channel. If another run already
    // claimed it (unique violation), skip — never double-send.
    let deliveryId: string;
    try {
      const row = await prisma.notificationDelivery.create({
        data: { notificationId: c.id, channel: 'whatsapp', status: 'pending' },
        select: { id: true },
      });
      deliveryId = row.id;
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }

    const tCtx = taskCtx.get(c.id);
    const tf = typeof payload.timelineFileId === 'string' ? tfById.get(payload.timelineFileId) : undefined;
    const ctx: TemplateContext = {
      taskName: tCtx?.taskName ?? null,
      dueDate: tCtx?.dueDate ?? null,
      actorName: tCtx?.actorName ?? null,
      tfRefNo: tf?.refNo ?? null,
      tfSubject: tf?.subject ?? null,
    };

    const tmpl = mapNotificationToTemplate(c.type, payload, ctx);
    if (!tmpl) {
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: 'skipped', lastError: 'no template for type/reason' },
      });
      counts.skipped++;
      continue;
    }

    const toNumber = toWhatsAppNumber(c.user.phone);
    if (!toNumber) {
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: 'failed', templateName: tmpl.templateName, lastError: 'invalid phone number', attempts: 1 },
      });
      counts.failed++;
      continue;
    }

    const result = await sendWhatsAppTemplate({
      toNumber,
      templateName: tmpl.templateName,
      bodyParams: tmpl.bodyParams,
    });

    if (result.status === 'sent') {
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'sent',
          toNumber,
          templateName: tmpl.templateName,
          providerMessageId: result.providerMessageId,
          sentAt: new Date(),
          attempts: 1,
        },
      });
      counts.sent++;
    } else if (result.status === 'unknown') {
      // 504 / network — provider may have accepted. Leave as 'unknown', do NOT
      // auto-retry (no idempotency). Surface for manual review.
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: 'unknown', toNumber, templateName: tmpl.templateName, lastError: result.reason, attempts: 1 },
      });
      counts.unknown++;
    } else {
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'failed',
          toNumber,
          templateName: tmpl.templateName,
          lastError: `${result.errorCode ?? result.httpStatus}: ${result.error}`,
          attempts: 1,
        },
      });
      counts.failed++;
    }
  }

  return NextResponse.json(counts);
}
