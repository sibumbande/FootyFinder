-- DEC-021 A5: when the team that took the other side withdraws, its side (MatchTeam) is removed and its tickets' team
-- link is cleared (ON DELETE SET NULL). Those tickets are no longer live (CHOICE_PENDING or CLOSED), so only a live
-- team ticket (being paid for, or confirmed) must name its team side. Additive: narrows one CHECK.
BEGIN;
ALTER TABLE "MatchTicket" DROP CONSTRAINT "MatchTicket_team_seat_check";
ALTER TABLE "MatchTicket" ADD CONSTRAINT "MatchTicket_team_seat_check"
  CHECK ("seat" <> 'TEAM' OR "matchTeamId" IS NOT NULL OR "status" NOT IN ('HELD', 'CONFIRMED'));
COMMIT;
