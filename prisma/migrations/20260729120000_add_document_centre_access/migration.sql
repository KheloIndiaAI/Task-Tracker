-- Per-user Document Centre access grant. Replaces the hardcoded executive
-- username allowlist (osd.myas / osd.ss / osd.dgsai) with a Super-Admin-managed
-- toggle set from Users > Create / Edit. Access = is_super_admin OR this flag
-- (see canAccessDocumentCentre in src/lib/document-centre-shared.ts).
--
-- Idempotent by design: safe to apply to a fresh database and to a prod
-- database that may already carry the column from `db push` drift.

-- AddColumn
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_access_document_centre" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: preserve access for the accounts that previously had it through the
-- retired username allowlist. Super Admins keep access via is_super_admin and do
-- not need the flag set. ON the WHERE clause this is naturally idempotent.
UPDATE "users" SET "can_access_document_centre" = true
WHERE "username" IN ('osd.myas', 'osd.ss', 'osd.dgsai');
