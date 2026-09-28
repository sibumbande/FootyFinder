import type { MatchFormat } from '@footy-finder/shared';
import { useQuery } from '@tanstack/react-query';
import { venuesClient } from '@/api/client.js';

export const venuesKey = ['venues'] as const;
export const useVenues = () => useQuery({ queryKey: venuesKey, queryFn: async () => (await venuesClient.list()).data });
export const useVenue = (slug: string) => useQuery({ queryKey: [...venuesKey, slug], queryFn: async () => (await venuesClient.get(slug)).data, enabled: Boolean(slug) });
export const useVenueSlots = (slug: string, fieldId: string, format: MatchFormat, dateFrom: string, dateTo: string) => useQuery({
  queryKey: [...venuesKey, slug, 'slots', fieldId, format, dateFrom, dateTo],
  queryFn: async () => (await venuesClient.slots(slug, { fieldId, format, dateFrom, dateTo })).data,
  enabled: Boolean(slug && fieldId && dateFrom && dateTo),
});
