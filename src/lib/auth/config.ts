import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe NextAuth config.
 *
 * Why split: middleware runs on the edge runtime and cannot import
 * Prisma or other Node-only modules used in the Credentials provider's
 * `authorize` callback. This file contains only what middleware needs —
 * pages, callbacks that don't touch Node APIs, route gating logic.
 *
 * The full config — including the Credentials provider — lives in
 * src/lib/auth/index.ts (Node runtime).
 *
 * See: https://authjs.dev/guides/edge-compatibility
 */
export const authConfig = {
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 28800,
  },
  callbacks: {
    /**
     * Route gating. Returns true to allow, false to redirect to signIn page.
     * Special return: a `Response.redirect` for finer-grained control.
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const pathname = nextUrl.pathname;

      const isOnLogin = pathname.startsWith('/login');
      const isOnChangePassword = pathname.startsWith('/profile/change-password');
      const isOnPublicRoute =
        pathname.startsWith('/_next') ||
        pathname.startsWith('/favicon') ||
        pathname === '/robots.txt' ||
        // PWA assets — fetched by the browser without a session when
        // installing or launching the app (mirrors the middleware matcher).
        pathname === '/manifest.webmanifest' ||
        pathname === '/sw.js' ||
        pathname === '/offline.html' ||
        pathname.startsWith('/icons/') ||
        pathname.startsWith('/splash/') ||
        pathname.startsWith('/api/auth') ||
        pathname.startsWith('/api/cron') ||
        pathname.startsWith('/s/');

      if (isOnPublicRoute) return true;

      // Not logged in: only the login page is accessible.
      if (!isLoggedIn) {
        return isOnLogin;
      }

      // Logged in but flagged to change password: lock them to the change-password page.
      const forcePwd = (auth?.user as { forcePasswordChange?: boolean } | undefined)
        ?.forcePasswordChange;
      if (forcePwd && !isOnChangePassword) {
        return Response.redirect(new URL('/profile/change-password', nextUrl));
      }

      // Logged in and on /login: send to the home screen.
      if (isOnLogin) {
        return Response.redirect(new URL('/tasks', nextUrl));
      }

      return true;
    },

    /**
     * Persist app-specific claims on the JWT.
     * Runs on every request that touches the session.
     */
    async jwt({ token, user }) {
      if (user) {
        token.userId = (user as { id: string }).id;
        token.username = (user as { username: string }).username;
        token.hierarchySlot = (user as { hierarchySlot: string }).hierarchySlot;
        token.isSuperAdmin = (user as { isSuperAdmin: boolean }).isSuperAdmin;
        token.divisionId = (user as { divisionId: string }).divisionId;
        token.forcePasswordChange = (user as { forcePasswordChange: boolean })
          .forcePasswordChange;
        token.claimsRefreshedAt = Date.now();
      }

      const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
      const lastRefreshed = (token.claimsRefreshedAt as number | undefined) ?? 0;
      if (token.userId && Date.now() - lastRefreshed > REFRESH_INTERVAL_MS) {
        try {
          const { prisma } = await import('@/lib/db');
          const fresh = await prisma.user.findUnique({
            where: { id: token.userId as string },
            select: {
              isActive: true,
              isSuperAdmin: true,
              hierarchySlot: true,
              divisionId: true,
              username: true,
              forcePasswordChange: true,
            },
          });
          if (!fresh || !fresh.isActive) {
            return { ...token, userId: undefined };
          }
          token.username = fresh.username;
          token.hierarchySlot = fresh.hierarchySlot;
          token.isSuperAdmin = fresh.isSuperAdmin;
          token.divisionId = fresh.divisionId;
          token.forcePasswordChange = fresh.forcePasswordChange;
          token.claimsRefreshedAt = Date.now();
        } catch {
          // DB unavailable — keep stale claims until next attempt
        }
      }

      return token;
    },

    /**
     * Expose claims to the client session object.
     */
    async session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = token.userId as string;
        session.user.username = token.username as string;
        session.user.hierarchySlot = token.hierarchySlot as string;
        session.user.isSuperAdmin = token.isSuperAdmin as boolean;
        session.user.divisionId = token.divisionId as string;
        session.user.forcePasswordChange = token.forcePasswordChange as boolean;
      }
      return session;
    },
  },
  providers: [
    // Real providers are attached in src/lib/auth/index.ts.
    // Middleware never needs to call `authorize`, so this is fine.
  ],
} satisfies NextAuthConfig;
