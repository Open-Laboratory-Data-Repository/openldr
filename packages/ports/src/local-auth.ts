// Storage for AUTH_ADAPTER=local: passwords, sessions, the token signing key and the one-time
// setup code. First and last name live on the users row, not here, because an account can
// exist with no password.

export interface LocalCredential {
  userId: string; passwordHash: string; mustChange: boolean; failedCount: number;
  lockedUntil: Date | null; passwordChangedAt: Date;
}
export interface LocalSession { id: string; userId: string; secretHash: string; createdAt: Date; lastUsedAt: Date; expiresAt: Date }
export interface StoredSigningKey { kid: string; sealedPrivateJwk: string; publicJwk: Record<string, unknown> }
export interface LocalAuthStore {
  /** Inserts a users row with subject = id and rbac_initialized = true. */
  createUser(input: { username: string; email?: string | null; displayName?: string | null }): Promise<{ id: string }>;
  findUserIdByIdentifier(identifier: string): Promise<string | null>;
  getCredential(userId: string): Promise<LocalCredential | null>;
  /** Upsert. Clears failed_count and locked_until. Sets password_changed_at to now. */
  setPassword(userId: string, passwordHash: string, mustChange: boolean): Promise<void>;
  /**
   * Compare-and-set. Writes only when the stored hash still equals `expectedPasswordHash`, and
   * then does what `setPassword` does. True when it wrote a row. Never inserts.
   */
  replacePassword(userId: string, expectedPasswordHash: string, passwordHash: string, mustChange: boolean): Promise<boolean>;
  /** Writes users.first_name and users.last_name. Works with or without a credential row. */
  setNames(userId: string, firstName: string | null, lastName: string | null): Promise<void>;
  /** Both null when the user does not exist. */
  getNames(userId: string): Promise<{ firstName: string | null; lastName: string | null }>;
  recordFailure(userId: string, now: Date, maxFailures: number, lockMs: number): Promise<{ lockedUntil: Date | null }>;
  clearFailures(userId: string): Promise<void>;
  anyCredentialExists(): Promise<boolean>;
  createSession(input: { userId: string; secretHash: string; expiresAt: Date; ip: string | null; userAgent: string | null }): Promise<LocalSession>;
  getSession(id: string): Promise<LocalSession | null>;
  touchSession(id: string, now: Date): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForUser(userId: string, exceptSessionId?: string): Promise<number>;
  getSigningKey(): Promise<StoredSigningKey | null>;
  /** Inserts only when the table is empty. Returns the row that is stored afterwards. */
  insertSigningKeyIfNone(key: StoredSigningKey): Promise<StoredSigningKey>;
  replaceSetupCode(codeHash: string, expiresAt: Date): Promise<void>;
  /** Deletes the row when hash matches and it has not expired. True when it deleted one. */
  consumeSetupCode(codeHash: string, now: Date): Promise<boolean>;
}
