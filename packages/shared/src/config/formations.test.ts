import { describe, expect, it } from 'vitest';
import {
  createFormationPresetSlots,
  mapMatchHalfPositionToTeam,
  mapTeamPositionToMatchHalf,
} from './formations.js';

describe('Match half formation mapping', () => {
  it.each(['FIVE_A_SIDE', 'SEVEN_A_SIDE', 'ELEVEN_A_SIDE'] as const)(
    'maps %s positions into each side and reverses without drift',
    (format) => {
      const keys = {
        FIVE_A_SIDE: 'BALANCED_1_1_2_1',
        SEVEN_A_SIDE: 'BALANCED_1_2_3_1',
        ELEVEN_A_SIDE: 'BALANCED_4_3_3',
      } as const;
      for (const slot of createFormationPresetSlots(format, keys[format])) {
        const home = mapTeamPositionToMatchHalf('HOME', slot);
        const away = mapTeamPositionToMatchHalf('AWAY', slot);
        expect(home.positionY).toBeGreaterThanOrEqual(50);
        expect(away.positionY).toBeLessThanOrEqual(50);
        expect(mapMatchHalfPositionToTeam('HOME', home)).toEqual({
          positionX: slot.positionX,
          positionY: slot.positionY,
        });
        expect(mapMatchHalfPositionToTeam('AWAY', away)).toEqual({
          positionX: slot.positionX,
          positionY: slot.positionY,
        });
      }
    },
  );
});
