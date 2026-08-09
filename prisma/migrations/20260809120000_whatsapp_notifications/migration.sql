-- WhatsApp notifications: per-user opt-in (default on) + a delivery outbox
-- that dedupes and records the status of each WhatsApp send.

-- Opt-out model: everyone with a phone number is opted in until they turn it off.
ALTER TABLE "users" ADD COLUMN "whatsapp_opt_in" boolean NOT NULL DEFAULT true;

-- Delivery outbox. One row per (notification, channel). The unique index is the
-- dedupe key: a re-run of the drain can never send the same notification twice.
CREATE TABLE "notification_delivery" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" uuid NOT NULL,
    "channel" text NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "to_number" text,
    "template_name" text,
    "provider_message_id" text,
    "attempts" integer NOT NULL DEFAULT 0,
    "last_error" text,
    "created_at" timestamptz(6) NOT NULL DEFAULT now(),
    "sent_at" timestamptz(6),
    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_delivery_notification_id_fkey"
        FOREIGN KEY ("notification_id") REFERENCES "notifications"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "notification_delivery_notification_id_channel_key"
    ON "notification_delivery" ("notification_id", "channel");

CREATE INDEX "notification_delivery_status_idx"
    ON "notification_delivery" ("status");
