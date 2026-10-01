/**
 * CEO touch-up batch 3, item 10: "1 member", "2 members" (never "1 members").
 * plural(3, 'review') -> "3 reviews"; plural(1, 'place left', 'places left') -> "1 place left".
 */
export const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;
