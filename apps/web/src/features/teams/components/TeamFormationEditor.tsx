import {
  FORMATION_PRESETS,
  MATCH_FORMAT_CONFIG,
  MATCH_FORMATS,
  type FormationSlot,
  type MatchFormat,
  type MatchParticipant,
  type TeamDetail,
} from '@footy-finder/shared';
import { useState } from 'react';
import { FormError } from '@/components/ui/FormError.js';
import { FormationBoard } from '@/features/matches/components/formation/FormationBoard.js';
import { useTeamFormation, useTeamFormationMutations } from '../hooks/useTeams.js';

export function TeamFormationEditor({ team }: { team: TeamDetail }) {
  const [format, setFormat] = useState<MatchFormat>(team.primaryFormat);
  const formation = useTeamFormation(team.id, format);
  const mutations = useTeamFormationMutations(team.id, format);
  const canEdit = team.viewerRole === 'OWNER' || team.viewerRole === 'CAPTAIN';
  const participants: MatchParticipant[] = team.members.map((member) => ({
    id: member.id,
    matchId: team.id,
    userId: member.userId,
    status: 'JOINED',
    team: 'HOME',
    joinedAt: member.joinedAt,
    user: member.user,
  }));
  const slots: FormationSlot[] =
    formation.data?.slots.map((slot) => ({
      id: slot.id,
      matchId: team.id,
      team: 'HOME',
      slotIndex: slot.slotIndex,
      positionX: slot.positionX,
      positionY: slot.positionY,
      participantId: slot.membershipId,
      participant: slot.member
        ? (participants.find(({ id }) => id === slot.member?.id) ?? null)
        : null,
    })) ?? [];
  return (
    <section className="grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="grid gap-2 text-sm font-semibold text-content">
          Match format
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as MatchFormat)}
            className="min-h-11 rounded-xl border border-line-strong bg-surface px-3"
          >
            {MATCH_FORMATS.map((item) => (
              <option key={item} value={item}>
                {MATCH_FORMAT_CONFIG[item].label}
              </option>
            ))}
          </select>
        </label>
        {canEdit && formation.data && (
          <label className="grid gap-2 text-sm font-semibold text-content">
            Formation preset
            <select
              value={formation.data.formationKey}
              onChange={(event) => mutations.preset.mutate(event.target.value)}
              className="min-h-11 rounded-xl border border-line-strong bg-surface px-3"
            >
              {FORMATION_PRESETS[format].map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <FormError
        message={
          formation.error?.message ??
          mutations.preset.error?.message ??
          mutations.slot.error?.message
        }
      />
      {formation.isPending ? (
        <div className="h-[38rem] animate-pulse rounded-3xl bg-surface-muted" />
      ) : formation.data ? (
        <FormationBoard
          slots={slots}
          participants={participants}
          isHost={canEdit}
          editable={canEdit}
          sides={['HOME']}
          reserveLabels={{ HOME: 'Squad' }}
          heading={`${MATCH_FORMAT_CONFIG[format].shortLabel} Team formation`}
          editableHint="Drag or tap squad members into position. Changes save immediately."
          readonlyHint="Owner and captains manage this saved Team formation."
          update={(slotId, input) =>
            mutations.slot.mutateAsync({
              slotId,
              input: {
                membershipId: input.participantId,
                positionX: input.positionX,
                positionY: input.positionY,
              },
            })
          }
        />
      ) : null}
    </section>
  );
}
