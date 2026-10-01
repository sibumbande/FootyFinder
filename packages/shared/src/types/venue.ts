import type { MatchFormat } from '../config/match-formats.js';

// DEC-018: public and player-facing venue DTOs never carry venue costs (ManagedFieldPrice amounts).
// Prices are admin-only data; see ManagedVenue/ManagedField types used by the admin app.
export interface PublicVenueMedia {
  url: string;
  /** CEO touch-up batch 3, item 1: a 400 px thumbnail for uploaded photos. */
  thumbUrl?: string;
  altText: string;
  attribution: string;
}

export interface PublicVenueField {
  id: string;
  name: string;
  description?: string;
  supportedFormats: MatchFormat[];
  turnaroundBufferMinutes: number;
}

export interface PublicVenueCard {
  slug: string;
  name: string;
  city: string;
  region: string;
  coverImage: PublicVenueMedia;
  supportedFormats: MatchFormat[];
}

export interface PublicVenueDetail extends PublicVenueCard {
  description: string;
  addressLine1: string;
  addressLine2?: string;
  postalCode?: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
  amenities: string[];
  gallery: PublicVenueMedia[];
  fields: PublicVenueField[];
  /** CEO touch-up batch 3, item 2: "About this venue" and up to five links. */
  aboutText?: string;
  links: Array<{ type: 'WEBSITE' | 'INSTAGRAM' | 'FACEBOOK' | 'X' | 'TIKTOK' | 'OTHER'; label: string; url: string }>;
}

export interface VenueAvailabilitySlot {
  fieldId: string;
  format: MatchFormat;
  startsAt: string;
  endsAt: string;
  localDate: string;
  localTime: string;
  timezone: string;
}
