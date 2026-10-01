import { describe, expect, it } from 'vitest';
import { csvCell, saDate, toWaitingListCsv } from './waiting-list-csv.js';

describe('waiting-list CSV (CEO batch 3.5, item 4)', () => {
  it('quotes every cell and doubles quotes', () => {
    expect(csvCell('a "b" c')).toBe('"a ""b"" c"');
  });

  it('neutralises cells Excel would run as formulas', () => {
    for (const value of ['=1+1', '+27', '-cmd', '@SUM(A1)', '\tx'])
      expect(csvCell(value)).toBe(`"'${value}"`);
    expect(csvCell('player@example.com')).toBe('"player@example.com"');
  });

  it('dates rows in South African time and labels the source', () => {
    expect(saDate(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01');
    const csv = toWaitingListCsv([{ email: 'a@example.com', cityName: 'East London (KuGompo)', signedUpAt: new Date('2026-10-01T08:00:00Z'), source: 'WAITING_LIST_PAGE' }]);
    expect(csv).toBe('"Email","City","Signed up","Source"\r\n"a@example.com","East London (KuGompo)","2026-10-01","Waiting list page"\r\n');
  });
});
