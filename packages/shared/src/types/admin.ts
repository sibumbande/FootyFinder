export interface AdminAuthStatus {
  configured: boolean;
  verified: boolean;
  verifiedAt?: string;
}

export interface AdminMfaSetup extends AdminAuthStatus {
  secret: string;
  otpauthUri: string;
}

export interface AdminAuditActor {
  id: string;
  username: string;
  displayName: string;
}

export interface AdminAuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  actor?: AdminAuditActor;
}

export type ManagedFieldStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
export interface ManagedFieldAvailability {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}
export interface ManagedFieldException {
  id: string;
  startsAt: string;
  endsAt: string;
  available: boolean;
  reason?: string;
}
export interface ManagedFieldPrice {
  id: string;
  amountCents: number;
  currency: 'ZAR';
  format?: 'FIVE_A_SIDE' | 'SEVEN_A_SIDE' | 'ELEVEN_A_SIDE';
  dayOfWeek?: number;
  startMinute?: number;
  endMinute?: number;
  effectiveFrom: string;
  effectiveTo?: string;
}
export interface ManagedField {
  id: string;
  venueId: string;
  name: string;
  description?: string;
  status: ManagedFieldStatus;
  turnaroundBufferMinutes: number;
  supportedFormats: Array<'FIVE_A_SIDE' | 'SEVEN_A_SIDE' | 'ELEVEN_A_SIDE'>;
  availabilityPeriods: ManagedFieldAvailability[];
  exceptions: ManagedFieldException[];
  prices: ManagedFieldPrice[];
  createdAt: string;
  updatedAt: string;
}
export interface ManagedVenue {
  id: string;
  slug: string;
  name: string;
  publicDescription?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region: string;
  postalCode?: string;
  countryCode: string;
  latitude?: number;
  longitude?: number;
  timezone: string;
  amenities: string[];
  coverImageUrl?: string;
  coverImageAlt?: string;
  coverImageAttribution?: string;
  publicationStatus: 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED' | 'DEACTIVATED';
  submittedByUserId?: string;
  submittedAt?: string;
  approvedByUserId?: string;
  approvedAt?: string;
  deactivatedAt?: string;
  deactivationReason?: string;
  isActive: boolean;
  media: Array<{ id: string; url: string; thumbUrl?: string; altText: string; attribution: string; sortOrder: number }>;
  /** CEO touch-up batch 3 (D1): photo/bio/link changes on a live venue waiting for a second admin. */
  pendingContentChange?: VenueContentChangeView;
  cancellationPolicies: Array<{
    id: string;
    effectiveFrom: string;
    effectiveTo?: string;
    fullCreditBeforeHours: number;
    lateCreditPercent: number;
    venueCancellationPercent: number;
    policyText: string;
  }>;
  fields: ManagedField[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminTestDataStatus {
  enabled: boolean;
  environment: 'development' | 'test' | 'production';
}
export interface AdminTestAccount {
  id: string;
  email: string;
  username: string;
  displayName: string;
}
export interface AdminTestDataBatch {
  id: string;
  label: string;
  createdAt: string;
  accountCount: number;
  accounts?: AdminTestAccount[];
  temporaryPassword?: string;
}

/** CEO touch-up batch 3, item 1: a processed venue photo upload, staged until it is saved into the venue. */
export interface VenuePhotoUpload {
  fileId: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

/** CEO touch-up batch 3 (D1): the content a pending change would publish. */
export interface VenueContentPayload {
  photos: Array<{ url: string; thumbUrl?: string; altText: string; attribution: string; storageKey?: string; thumbKey?: string }>;
  coverIndex: number;
}

export interface VenueContentChangeView {
  id: string;
  submittedByUserId: string;
  submittedAt: string;
  payload: VenueContentPayload;
}
