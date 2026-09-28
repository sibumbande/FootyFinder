import type { MatchFormat } from '../config/match-formats.js';

export interface PublicVenueMedia {
  url: string;
  altText: string;
  attribution: string;
}

export interface PublicVenueField {
  id: string;
  name: string;
  description?: string;
  supportedFormats: MatchFormat[];
  turnaroundBufferMinutes: number;
  fromPriceCents?: number;
}

export interface PublicVenueCard {
  slug: string;
  name: string;
  city: string;
  region: string;
  coverImage: PublicVenueMedia;
  supportedFormats: MatchFormat[];
  fromPriceCents?: number;
  currency: 'ZAR';
  priceUnit: '60_MINUTE_FIELD_SLOT';
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
  cancellationPolicy: {
    fullCreditBeforeHours: number;
    lateCreditPercent: number;
    venueCancellationPercent: number;
    policyText: string;
  };
}

export interface VenueAvailabilitySlot {
  fieldId: string;
  format: MatchFormat;
  startsAt: string;
  endsAt: string;
  localDate: string;
  localTime: string;
  timezone: string;
  priceCents: number;
  currency: 'ZAR';
  priceUnit: '60_MINUTE_FIELD_SLOT';
}
