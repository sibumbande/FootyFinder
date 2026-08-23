import { getPlayersPerTeam, type MatchFormat } from './match-formats.js';
import type { TeamSide } from '../types/match.js';

export interface DefaultFormationSlot {
  team: TeamSide;
  slotIndex: number;
  positionX: number;
  positionY: number;
}

const homeLayouts: Record<MatchFormat, Array<[number, number]>> = {
  FIVE_A_SIDE: [
    [50, 91],
    [50, 70],
    [27, 46],
    [73, 46],
    [50, 20],
  ],
  SEVEN_A_SIDE: [
    [50, 92],
    [30, 72],
    [70, 72],
    [22, 48],
    [50, 48],
    [78, 48],
    [50, 20],
  ],
  ELEVEN_A_SIDE: [
    [50, 93],
    [18, 74],
    [39, 74],
    [61, 74],
    [82, 74],
    [28, 49],
    [50, 49],
    [72, 49],
    [20, 22],
    [50, 18],
    [80, 22],
  ],
};

export interface FormationPreset {
  key: string;
  label: string;
  positions: Array<[number, number]>;
}

export const FORMATION_PRESETS: Record<MatchFormat, FormationPreset[]> = {
  FIVE_A_SIDE: [
    { key: 'BALANCED_1_1_2_1', label: 'Balanced 1-1-2-1', positions: homeLayouts.FIVE_A_SIDE },
    {
      key: 'DIAMOND_1_2_1_1',
      label: 'Compact diamond',
      positions: [
        [50, 91],
        [28, 66],
        [72, 66],
        [50, 43],
        [50, 18],
      ],
    },
  ],
  SEVEN_A_SIDE: [
    { key: 'BALANCED_1_2_3_1', label: 'Balanced 1-2-3-1', positions: homeLayouts.SEVEN_A_SIDE },
    {
      key: 'COMPACT_1_3_2_1',
      label: 'Compact 1-3-2-1',
      positions: [
        [50, 92],
        [22, 69],
        [50, 72],
        [78, 69],
        [34, 43],
        [66, 43],
        [50, 18],
      ],
    },
  ],
  ELEVEN_A_SIDE: [
    { key: 'BALANCED_4_3_3', label: '4-3-3', positions: homeLayouts.ELEVEN_A_SIDE },
    {
      key: 'CLASSIC_4_4_2',
      label: '4-4-2',
      positions: [
        [50, 93],
        [18, 74],
        [39, 74],
        [61, 74],
        [82, 74],
        [17, 48],
        [39, 50],
        [61, 50],
        [83, 48],
        [36, 20],
        [64, 20],
      ],
    },
  ],
};

export const getFormationPresets = (format: MatchFormat) => FORMATION_PRESETS[format];
export const getDefaultFormationKey = (format: MatchFormat) => FORMATION_PRESETS[format][0].key;
export const getFormationPreset = (format: MatchFormat, key: string) =>
  FORMATION_PRESETS[format].find((preset) => preset.key === key);

export function createFormationPresetSlots(format: MatchFormat, formationKey: string) {
  const preset = getFormationPreset(format, formationKey);
  if (!preset || preset.positions.length !== getPlayersPerTeam(format))
    throw new Error(`Invalid formation preset ${formationKey} for ${format}.`);
  return preset.positions.map(([positionX, positionY], index) => ({
    slotIndex: index + 1,
    positionX,
    positionY,
  }));
}

export function mapTeamPositionToMatchHalf(
  side: TeamSide,
  position: { positionX: number; positionY: number },
) {
  return {
    positionX: position.positionX,
    positionY: side === 'HOME' ? 50 + position.positionY / 2 : 50 - position.positionY / 2,
  };
}

export function mapMatchHalfPositionToTeam(
  side: TeamSide,
  position: { positionX: number; positionY: number },
) {
  return {
    positionX: position.positionX,
    positionY: side === 'HOME' ? (position.positionY - 50) * 2 : (50 - position.positionY) * 2,
  };
}

export function createDefaultFormation(format: MatchFormat): DefaultFormationSlot[] {
  const home = getFormationPresets(format)[0].positions;
  if (home.length !== getPlayersPerTeam(format))
    throw new Error(`Invalid formation configuration for ${format}.`);
  return (['HOME', 'AWAY'] as const).flatMap((team) =>
    home.map(([positionX, homeY], index) => ({
      team,
      slotIndex: index + 1,
      positionX,
      positionY: team === 'HOME' ? homeY : 100 - homeY,
    })),
  );
}
