export { formatRands } from '@/utils/format-currency.js';

export const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' });
