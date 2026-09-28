import type { MatchFormat, PublicVenueCard, PublicVenueDetail, VenueAvailabilitySlot } from '@footy-finder/shared';
import type { ApiClient } from './client.js';

export const venuesApi = (client: ApiClient) => ({
  list: () => client.request<{ data: PublicVenueCard[] }>('/venues'),
  get: (slug: string) => client.request<{ data: { venue: PublicVenueDetail; canonicalSlug: string; wasAlias: boolean } }>(`/venues/${encodeURIComponent(slug)}`),
  slots: (slug: string, query: { fieldId: string; format: MatchFormat; dateFrom: string; dateTo: string }) => {
    const params = new URLSearchParams(query);
    return client.request<{ data: VenueAvailabilitySlot[] }>(`/venues/${encodeURIComponent(slug)}/slots?${params}`);
  },
});
