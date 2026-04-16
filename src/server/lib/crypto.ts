// Crypto utilities — password hashing, token encryption, token generation
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;
const AES_ALGORITHM = 'aes-256-gcm';

// ── Password hashing (bcrypt) ────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── Token encryption (AES-256-GCM) ──────────────

function deriveKey(secret: string): Buffer {
  // SHA-256 the secret to get exactly 32 bytes for AES-256
  return createHash('sha256').update(secret).digest();
}

export function encryptToken(
  plain: string,
  encryptionKey: string,
): { encrypted: string; iv: string; authTag: string } {
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(16);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);

  let encrypted = cipher.update(plain, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

export function decryptToken(
  encrypted: string,
  iv: string,
  authTag: string,
  encryptionKey: string,
): string {
  const key = deriveKey(encryptionKey);
  const decipher = createDecipheriv(AES_ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// ── Token hashing (SHA-256) ─────────────────────

export function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

// ── Token generation ────────────────────────────

export function generateApiToken(): string {
  return 'cp_live_' + randomBytes(24).toString('hex'); // 48 hex chars
}
