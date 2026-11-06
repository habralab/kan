-- Existing downstream databases passed the upstream board-member migrations'
-- timestamps before those migrations reached this branch. Drizzle selects only
-- migrations newer than the latest recorded timestamp, so apply their schema
-- and backfill once here. Fresh databases already ran the upstream migrations.
DO $bridge$
BEGIN
  IF EXISTS (
    SELECT 1 FROM drizzle.__drizzle_migrations
    WHERE created_at = 1790111796287
  ) THEN
    IF to_regclass('public.board_members') IS NULL THEN
      RAISE EXCEPTION 'Board member backfill is recorded but board_members is missing';
    END IF;
    RETURN;
  END IF;

  IF to_regclass('public.board_members') IS NOT NULL THEN
    RAISE EXCEPTION 'board_members exists without its upstream backfill marker';
  END IF;

  CREATE TYPE "public"."board_member_role" AS ENUM('admin', 'member');
  CREATE TABLE "board_members" (
    "boardId" bigint NOT NULL,
    "workspaceMemberId" bigint NOT NULL,
    "role" "board_member_role" DEFAULT 'member' NOT NULL,
    "createdBy" uuid,
    "createdAt" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "board_members_boardId_workspaceMemberId_pk"
      PRIMARY KEY("boardId", "workspaceMemberId")
  );
  ALTER TABLE "board_members" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "board_members" ADD CONSTRAINT "board_members_boardId_board_id_fk"
    FOREIGN KEY ("boardId") REFERENCES "public"."board"("id")
    ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "board_members" ADD CONSTRAINT "board_members_workspaceMemberId_workspace_members_id_fk"
    FOREIGN KEY ("workspaceMemberId") REFERENCES "public"."workspace_members"("id")
    ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "board_members" ADD CONSTRAINT "board_members_createdBy_user_id_fk"
    FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action;
  CREATE INDEX "board_members_workspace_member_idx"
    ON "board_members" USING btree ("workspaceMemberId");

  -- Keep the upstream BackfillBoardMembers selection and role rules verbatim.
  WITH admin_candidate AS (
    SELECT DISTINCT ON (b."id")
      b."id" AS board_id,
      wm."id" AS workspace_member_id
    FROM "board" b
    INNER JOIN "workspace_members" wm ON wm."workspaceId" = b."workspaceId"
    WHERE b."deletedAt" IS NULL
      AND b."type" = 'regular'
      AND wm."deletedAt" IS NULL
      AND wm."status" <> 'removed'
    ORDER BY
      b."id",
      (wm."status" = 'active') DESC,
      (wm."userId" IS NOT NULL AND wm."userId" = b."createdBy") DESC,
      (wm."userId" IS NOT NULL) DESC,
      wm."id" ASC
  )
  INSERT INTO "board_members" ("boardId", "workspaceMemberId", "role", "createdAt")
  SELECT
    b."id",
    wm."id",
    CASE
      WHEN ac.workspace_member_id = wm."id" THEN 'admin'::"board_member_role"
      ELSE 'member'::"board_member_role"
    END,
    now()
  FROM "board" b
  INNER JOIN "workspace_members" wm ON wm."workspaceId" = b."workspaceId"
  LEFT JOIN admin_candidate ac ON ac.board_id = b."id"
  WHERE b."deletedAt" IS NULL
    AND b."type" = 'regular'
    AND wm."deletedAt" IS NULL
    AND wm."status" <> 'removed'
  ON CONFLICT DO NOTHING;
END $bridge$;
