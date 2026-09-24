-- Public share links: an unguessable, non-expiring token per attachment.
-- The public /s/<token> route resolves it, mints a fresh presigned URL at
-- click time, and redirects. Nullable + generated lazily the first time a
-- file is shared, so existing rows are unaffected.
ALTER TABLE "attachments" ADD COLUMN "share_token" text;
CREATE UNIQUE INDEX "attachments_share_token_key" ON "attachments"("share_token");
