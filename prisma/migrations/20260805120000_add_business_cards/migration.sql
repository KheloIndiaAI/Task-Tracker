-- Business Cards module: a toggle-gated shared workspace for contacts collected
-- at events. Adds a per-user access flag, a polymorphic-attachment owner type,
-- and two tables (events + cards). Access = is_super_admin OR the flag.
--
-- Idempotent by design: safe on a fresh database and on one that may already
-- carry these objects from `db push` drift.

-- Per-user access grant (mirrors can_access_document_centre).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_access_business_cards" BOOLEAN NOT NULL DEFAULT false;

-- Polymorphic Attachment owner type for uploaded business-card images / PDFs.
-- (Not used elsewhere in this migration, so safe to add in the same transaction on PG12+.)
ALTER TYPE "AttachmentOwnerType" ADD VALUE IF NOT EXISTS 'business_card';

-- Events: unique registered event names contacts can be grouped by.
CREATE TABLE IF NOT EXISTS "business_card_events" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_card_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "business_card_events_name_key" ON "business_card_events"("name");

-- Cards: one collected contact.
CREATE TABLE IF NOT EXISTS "business_cards" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "job_title" TEXT,
    "company" TEXT NOT NULL,
    "industry" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "remarks" TEXT,
    "event_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_cards_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "business_cards_created_by_idx" ON "business_cards"("created_by");
CREATE INDEX IF NOT EXISTS "business_cards_event_id_idx" ON "business_cards"("event_id");
CREATE INDEX IF NOT EXISTS "business_cards_last_activity_at_idx" ON "business_cards"("last_activity_at");
CREATE INDEX IF NOT EXISTS "business_cards_created_at_idx" ON "business_cards"("created_at" DESC);

-- Foreign keys (guarded — Postgres has no ADD CONSTRAINT IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_card_events_created_by_fkey') THEN
    ALTER TABLE "business_card_events"
      ADD CONSTRAINT "business_card_events_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_cards_event_id_fkey') THEN
    ALTER TABLE "business_cards"
      ADD CONSTRAINT "business_cards_event_id_fkey"
      FOREIGN KEY ("event_id") REFERENCES "business_card_events"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_cards_created_by_fkey') THEN
    ALTER TABLE "business_cards"
      ADD CONSTRAINT "business_cards_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;
