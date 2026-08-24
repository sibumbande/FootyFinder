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
