export const MATCH_FORMATS = ['FIVE_A_SIDE', 'SEVEN_A_SIDE', 'ELEVEN_A_SIDE'] as const;
export type MatchFormat = (typeof MATCH_FORMATS)[number];

export interface MatchFormatConfig {
  label: string;
  shortLabel: string;
  playersPerTeam: number;
  reservesPerTeam: number;
  onFieldCapacity: number;
  maxParticipantsPerTeam: number;
  maxParticipants: number;
}

export const MATCH_FORMAT_CONFIG: Record<MatchFormat, MatchFormatConfig> = {
  FIVE_A_SIDE: {
    label: '5-a-side',
    shortLabel: '5v5',
    playersPerTeam: 5,
    reservesPerTeam: 5,
    onFieldCapacity: 10,
    maxParticipantsPerTeam: 10,
    maxParticipants: 20,
  },
  SEVEN_A_SIDE: {
    label: '7-a-side',
    shortLabel: '7v7',
    playersPerTeam: 7,
    reservesPerTeam: 5,
    onFieldCapacity: 14,
    maxParticipantsPerTeam: 12,
    maxParticipants: 24,
  },
  ELEVEN_A_SIDE: {
    label: '11-a-side',
    shortLabel: '11v11',
    playersPerTeam: 11,
    reservesPerTeam: 5,
    onFieldCapacity: 22,
    maxParticipantsPerTeam: 16,
    maxParticipants: 32,
  },
};

export const getMatchFormatConfig = (format: MatchFormat) => MATCH_FORMAT_CONFIG[format];
export const getPlayersPerTeam = (format: MatchFormat) =>
  getMatchFormatConfig(format).playersPerTeam;
export const getReserveCapacity = (format: MatchFormat) =>
  getMatchFormatConfig(format).reservesPerTeam;
export const getOnFieldCapacity = (format: MatchFormat) =>
  getMatchFormatConfig(format).onFieldCapacity;
export const getMaxParticipantsPerTeam = (format: MatchFormat) =>
  getMatchFormatConfig(format).maxParticipantsPerTeam;
export const getMaxMatchParticipants = (format: MatchFormat) =>
  getMatchFormatConfig(format).maxParticipants;
