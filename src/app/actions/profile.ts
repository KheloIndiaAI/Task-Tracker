'use server';
import { logError } from '@/lib/utils/log';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { auth, signOut } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

/**
 * Profile-related server actions.
 *
 * changePassword:
 *   - Verifies current password against the stored argon2 hash
 *   - Enforces basic strength rules (length + cannot reuse current)
 *   - Writes new hash + sets password_changed_at + clears force_password_change
 *   - If the user was on a forced-change loop, sign them out so the next
 *     sign-in mints a fresh JWT without the force flag
 */

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .max(200, 'New password is too long'),
    confirmPassword: z.string().min(1, 'Confirm your new password').max(200),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'Choose a different password from the current one',
    path: ['newPassword'],
  });

type ChangePasswordState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<
    Record<'currentPassword' | 'newPassword' | 'confirmPassword', string>
  >;
  epoch?: number;
};

const INITIAL_CHANGE_PASSWORD_STATE: ChangePasswordState = {
  ok: false,
  epoch: 0,
};

export async function changePasswordAction(
  prev: ChangePasswordState | undefined,
  formData: FormData,
): Promise<ChangePasswordState> {
  const epoch = (prev?.epoch ?? 0) + 1;

  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'You are signed out. Refresh and try again.', epoch };
  }

  const { ok: allowed } = rateLimit(`password:${session.user.id}`, 5, 60_000);
  if (!allowed) {
    return { ok: false, error: 'Too many attempts. Wait a minute and try again.', epoch };
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    const fieldErrors: ChangePasswordState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (
        key === 'currentPassword' ||
        key === 'newPassword' ||
        key === 'confirmPassword'
      ) {
        fieldErrors[key] = issue.message;
      }
    }
    return { ok: false, fieldErrors, epoch };
  }

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      passwordHash: true,
      forcePasswordChange: true,
    },
  });
  if (!me) return { ok: false, error: 'Your account could not be found.', epoch };

  const oldOk = await verifyPassword(parsed.data.currentPassword, me.passwordHash);
  if (!oldOk) {
    return {
      ok: false,
      fieldErrors: { currentPassword: 'Current password is incorrect' },
      epoch,
    };
  }

  try {
    const newHash = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({
      where: { id: me.id },
      data: {
        passwordHash: newHash,
        passwordChangedAt: new Date(),
        forcePasswordChange: false,
      },
    });
  } catch (err) {
    logError('changePasswordAction failed', err);
    return { ok: false, error: 'Could not save the new password. Try again.', epoch };
  }

  // If the user was in a forced-change loop, the JWT still carries
  // forcePasswordChange = true. Mint a fresh session by signing them out.
  if (me.forcePasswordChange) {
    await signOut({ redirectTo: '/login?passwordChanged=1' });
    // signOut throws NEXT_REDIRECT — unreachable.
    return { ok: true, epoch };
  }

  revalidatePath('/profile');
  return { ok: true, epoch };
}

/**
 * Convenience server action: redirect to /profile (used after success when
 * the form is rendered from inside the AppShell).
 */
export async function returnToProfileAction() {
  redirect('/profile');
}

// ============================================================
// updateMyProfileAction — self-service phone + work activities
// ============================================================

/**
 * Every signed-in user can edit these two fields on their OWN row only —
 * the where clause is bound to the session id, never a submitted id.
 * Fields absent from the submitted form are left untouched; a field
 * present but empty is an explicit clear (same absent-vs-empty rule as
 * the task due-date fix).
 */

const updateMyProfileSchema = z.object({
  phone: z
    .string()
    .trim()
    .max(20, 'Phone number is too long')
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v.length === 0) return null;
      // Normalize: strip spaces/dashes/parens, drop a +91/91 country prefix.
      return v.replace(/[\s\-()]/g, '').replace(/^\+?91(?=\d{10}$)/, '');
    })
    .refine(
      (v) => v === undefined || v === null || /^[6-9]\d{9}$/.test(v),
      'Enter a valid 10-digit mobile number',
    ),
  workActivities: z
    .string()
    .max(5000, 'Keep work activities under 5000 characters')
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const trimmed = v.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
});

type UpdateMyProfileState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<'phone' | 'workActivities', string>>;
  epoch?: number;
};

export async function updateMyProfileAction(
  prev: UpdateMyProfileState | undefined,
  formData: FormData,
): Promise<UpdateMyProfileState> {
  const epoch = (prev?.epoch ?? 0) + 1;

  const session = await auth();
  if (!session?.user) return { ok: false, error: 'You are signed out.', epoch };

  const parsed = updateMyProfileSchema.safeParse({
    phone: formData.has('phone') ? (formData.get('phone') as string) : undefined,
    workActivities: formData.has('workActivities')
      ? (formData.get('workActivities') as string)
      : undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<'phone' | 'workActivities', string>> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]) as 'phone' | 'workActivities';
      fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors, epoch };
  }

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, phone: true, workActivities: true, isActive: true },
  });
  if (!me || !me.isActive) return { ok: false, error: 'Account not found.', epoch };

  const data: Record<string, string | null> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (parsed.data.phone !== undefined && parsed.data.phone !== me.phone) {
    data.phone = parsed.data.phone;
    before.phone = me.phone;
    after.phone = parsed.data.phone;
  }
  if (
    parsed.data.workActivities !== undefined &&
    parsed.data.workActivities !== me.workActivities
  ) {
    data.workActivities = parsed.data.workActivities;
    before.workActivities = me.workActivities;
    after.workActivities = parsed.data.workActivities;
  }

  if (Object.keys(data).length === 0) return { ok: true, epoch };

  try {
    await prisma.user.update({ where: { id: me.id }, data });
    await prisma.auditLog.create({
      data: {
        actorId: me.id,
        action: 'update',
        entityType: 'user',
        entityId: me.id,
        before: before as object,
        after: after as object,
      },
    });
  } catch (err) {
    logError('updateMyProfileAction failed', err);
    return { ok: false, error: 'Could not save changes.', epoch };
  }

  revalidatePath('/profile');
  revalidatePath(`/users/${me.id}`);
  return { ok: true, epoch };
}

// ============================================================
// setWhatsappOptInAction — self-service WhatsApp opt-out toggle
// ============================================================
// Append this to src/app/actions/profile.ts (it reuses the existing imports:
// auth, prisma, revalidatePath, logError). Called directly from the client
// toggle with a boolean; binds the update to the session id only.

export async function setWhatsappOptInAction(
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'You are signed out.' };

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, isActive: true, whatsappOptIn: true },
  });
  if (!me || !me.isActive) return { ok: false, error: 'Account not found.' };
  if (me.whatsappOptIn === enabled) return { ok: true };

  try {
    await prisma.user.update({
      where: { id: me.id },
      data: { whatsappOptIn: enabled },
    });
    await prisma.auditLog.create({
      data: {
        actorId: me.id,
        action: 'update',
        entityType: 'user',
        entityId: me.id,
        before: { whatsappOptIn: me.whatsappOptIn },
        after: { whatsappOptIn: enabled },
      },
    });
  } catch (err) {
    logError('setWhatsappOptInAction failed', err);
    return { ok: false, error: 'Could not save changes.' };
  }

  revalidatePath('/profile');
  return { ok: true };
}
