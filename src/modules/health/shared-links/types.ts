export type SharedLinkStatus = "active" | "expired" | "revoked";
export type SharedLinkRow = { id: string; userId?: string; publicToken: string | null; dataStartAt: Date; dataEndAt: Date; expiresAt: Date; revokedAt: Date | null; createdAt: Date; dataTypes?: unknown; };
