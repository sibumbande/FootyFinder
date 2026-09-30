import { WEEKDAY_LABELS, type FootballPosition, type MatchFormat, type RecruitmentLevel, type TimeOfDay } from '@footy-finder/shared';

export const FORMAT_LABELS: Record<MatchFormat, string> = { FIVE_A_SIDE: '5-a-side', SEVEN_A_SIDE: '7-a-side', ELEVEN_A_SIDE: '11-a-side' };
export const LEVEL_LABELS: Record<RecruitmentLevel, string> = { CASUAL: 'Casual', COMPETITIVE: 'Competitive' };
export const TIME_LABELS: Record<TimeOfDay, string> = { MORNING: 'Mornings', AFTERNOON: 'Afternoons', EVENING: 'Evenings' };
export const positionLabel = (position: FootballPosition) => position.charAt(0) + position.slice(1).toLowerCase();

/** "Mon, Wed · Evenings", or "Any day" when nothing is chosen. */
export function availabilityLabel(days: number[], times: TimeOfDay[]) {
  const dayText = days.length === 0 || days.length === 7 ? 'Any day' : [...days].sort().map((day) => WEEKDAY_LABELS[day]).join(', ');
  const timeText = times.length === 0 || times.length === 3 ? 'any time' : times.map((time) => TIME_LABELS[time]).join(', ');
  return `${dayText} · ${timeText}`;
}
