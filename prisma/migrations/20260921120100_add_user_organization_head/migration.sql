-- The "Organization head" toggle on Super Admin -> Users. When on, the user
-- heads the organization their home division sits in, with full head powers
-- over every division beneath it (and so, through each division's own head
-- rules, its PMU teams). Super Admins head every organization by role and
-- never need it.
--
-- Off for everyone: nobody gains any power from this migration alone.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_organization_head" BOOLEAN NOT NULL DEFAULT false;
