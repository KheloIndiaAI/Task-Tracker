# syntax=docker/dockerfile:1
# Next.js 14 (app router) + Prisma 5 + pnpm 9, built for linux/arm64 (Fargate ARM64)

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---- deps: install with lockfile; postinstall runs `prisma generate` ----
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ---- build: compile Next in production mode ----
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
ENV DIRECT_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
ENV AUTH_SECRET="build-time-placeholder"
ENV AUTH_TRUST_HOST="true"
# S3 vars at build time so next.config.mjs bakes the bucket into the CSP connect-src
ENV S3_ENDPOINT="https://s3.ap-south-1.amazonaws.com"
ENV S3_REGION="ap-south-1"
ENV S3_BUCKET="task-tracker-storage-bucket"
RUN pnpm build

# ---- runner: only what's needed to `next start` ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
CMD ["pnpm","start"]
