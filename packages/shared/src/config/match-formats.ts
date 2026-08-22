export const MATCH_FORMATS = ['FIVE_A_SIDE', 'SEVEN_A_SIDE', 'ELEVEN_A_SIDE'] as const;
export type MatchFormat = (typeof MATCH_FORMATS)[number];

export interface MatchFormatConfig {
  label: string;
  shortLabel: string;
  startersPerTeam: number;
  onFieldCapacity: number;
}

export const DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM = 5;
export const MAX_SUBSTITUTES_PER_TEAM = 10;

export const MATCH_FORMAT_CONFIG: Record<MatchFormat, MatchFormatConfig> = {
  FIVE_A_SIDE: {
    label: '5-a-side',
    shortLabel: '5v5',
    startersPerTeam: 5,
    onFieldCapacity: 10,
  },
  SEVEN_A_SIDE: {
    label: '7-a-side',
    shortLabel: '7v7',
    startersPerTeam: 7,
    onFieldCapacity: 14,
  },
  ELEVEN_A_SIDE: {
    label: '11-a-side',
    shortLabel: '11v11',
    startersPerTeam: 11,
    onFieldCapacity: 22,
  },
};

export const getMatchFormatConfig = (format: MatchFormat) => MATCH_FORMAT_CONFIG[format];
export const getPlayersPerTeam = (format: MatchFormat) =>
  getMatchFormatConfig(format).startersPerTeam;
export const getStarterCapacity = getPlayersPerTeam;
export const getOnFieldCapacity = (format: MatchFormat) =>
  getMatchFormatConfig(format).onFieldCapacity;
export const getMaxParticipantsPerTeam = (
  format: MatchFormat,
  substituteCapacityPerTeam = DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM,
) => getStarterCapacity(format) + substituteCapacityPerTeam;
export const getMaxMatchParticipants = (
  format: MatchFormat,
  substituteCapacityPerTeam = DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM,
) => getMaxParticipantsPerTeam(format, substituteCapacityPerTeam) * 2;
