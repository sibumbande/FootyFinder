-- Gate 9 / TKT-904 (CEO "add friends to your team", D11): the Owner or a Captain invites one
-- player personally: a friend of theirs, or (TKT-909) a player whose "Looking for a team" card is
-- on. The player accepts or declines in one tap; accepting adds them through the normal team
-- membership path. One pending invite per player per team; invites expire after 14 days. Blocking
-- either way refuses and cancels invites. Link invites (TeamInvite) are unchanged. No money is
-- involved. Additive only.
BEGIN;

CREATE TABLE "TeamMemberInvite" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "teamId" UUID NOT NULL,
  "inviteeId" UUID NOT NULL,
  "invitedById" UUID NOT NULL,
  "source" "TeamMemberInviteSource" NOT NULL,
  "status" "TeamMemberInviteStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamMemberInvite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamMemberInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamMemberInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamMemberInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamMemberInvite_not_self_check" CHECK ("inviteeId" <> "invitedById"),
  CONSTRAINT "TeamMemberInvite_responded_check" CHECK (("status" = 'PENDING') = ("respondedAt" IS NULL))
);
CREATE UNIQUE INDEX "TeamMemberInvite_one_pending_per_player" ON "TeamMemberInvite"("teamId", "inviteeId") WHERE "status" = 'PENDING';
CREATE INDEX "TeamMemberInvite_inviteeId_status_idx" ON "TeamMemberInvite"("inviteeId", "status");
CREATE INDEX "TeamMemberInvite_teamId_status_idx" ON "TeamMemberInvite"("teamId", "status");

COMMIT;
