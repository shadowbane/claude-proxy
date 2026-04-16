import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  encryptToken,
  decryptToken,
  hashToken,
  generateApiToken,
} from '../src/server/lib/crypto.js';

// ── Password hashing ────────────────────────────────

describe('hashPassword / verifyPassword', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('mypassword');
    expect(hash).not.toBe('mypassword');
    expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
    expect(await verifyPassword('mypassword', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('correct');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces different hashes for same input (unique salts)', async () => {
    const hash1 = await hashPassword('same');
    const hash2 = await hashPassword('same');
    expect(hash1).not.toBe(hash2);
    // Both should still verify
    expect(await verifyPassword('same', hash1)).toBe(true);
    expect(await verifyPassword('same', hash2)).toBe(true);
  });

  it('handles empty password', async () => {
    const hash = await hashPassword('');
    expect(await verifyPassword('', hash)).toBe(true);
    expect(await verifyPassword('notempty', hash)).toBe(false);
  });

  it('handles unicode passwords', async () => {
    const hash = await hashPassword('пароль123🔑');
    expect(await verifyPassword('пароль123🔑', hash)).toBe(true);
    expect(await verifyPassword('пароль123', hash)).toBe(false);
  });
});

// ── Token encryption (AES-256-GCM) ──────────────────

describe('encryptToken / decryptToken', () => {
  const key = 'my-secret-encryption-key';

  it('encrypts and decrypts a token', () => {
    const plain = 'cp_live_abc123def456';
    const { encrypted, iv, authTag } = encryptToken(plain, key);

    expect(encrypted).not.toBe(plain);
    expect(iv).toHaveLength(32); // 16 bytes -> 32 hex chars
    expect(authTag).toHaveLength(32); // 16 bytes -> 32 hex chars

    const decrypted = decryptToken(encrypted, iv, authTag, key);
    expect(decrypted).toBe(plain);
  });

  it('produces different ciphertexts for same input (random IV)', () => {
    const plain = 'same-token';
    const result1 = encryptToken(plain, key);
    const result2 = encryptToken(plain, key);

    expect(result1.encrypted).not.toBe(result2.encrypted);
    expect(result1.iv).not.toBe(result2.iv);

    // Both decrypt to the same value
    expect(decryptToken(result1.encrypted, result1.iv, result1.authTag, key)).toBe(plain);
    expect(decryptToken(result2.encrypted, result2.iv, result2.authTag, key)).toBe(plain);
  });

  it('fails to decrypt with wrong key', () => {
    const { encrypted, iv, authTag } = encryptToken('secret', key);
    expect(() => decryptToken(encrypted, iv, authTag, 'wrong-key')).toThrow();
  });

  it('fails to decrypt with tampered ciphertext', () => {
    const { encrypted, iv, authTag } = encryptToken('secret', key);
    const tampered = 'ff' + encrypted.slice(2); // flip first byte
    expect(() => decryptToken(tampered, iv, authTag, key)).toThrow();
  });

  it('fails to decrypt with tampered auth tag', () => {
    const { encrypted, iv, authTag } = encryptToken('secret', key);
    const tampered = 'ff' + authTag.slice(2);
    expect(() => decryptToken(encrypted, iv, tampered, key)).toThrow();
  });

  it('fails to decrypt with tampered IV', () => {
    const { encrypted, iv, authTag } = encryptToken('secret', key);
    const tampered = 'ff' + iv.slice(2);
    expect(() => decryptToken(encrypted, tampered, authTag, key)).toThrow();
  });

  it('handles empty string', () => {
    const { encrypted, iv, authTag } = encryptToken('', key);
    expect(decryptToken(encrypted, iv, authTag, key)).toBe('');
  });

  it('handles long tokens', () => {
    const long = 'x'.repeat(10_000);
    const { encrypted, iv, authTag } = encryptToken(long, key);
    expect(decryptToken(encrypted, iv, authTag, key)).toBe(long);
  });
});

// ── Token hashing (SHA-256) ─────────────────────────

describe('hashToken', () => {
  it('produces a 64-char hex SHA-256 digest', () => {
    const hash = hashToken('cp_live_abc123');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashToken('same')).toBe(hashToken('same'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('is case-sensitive', () => {
    expect(hashToken('Token')).not.toBe(hashToken('token'));
  });
});

// ── Token generation ────────────────────────────────

describe('generateApiToken', () => {
  it('starts with cp_live_ prefix', () => {
    const token = generateApiToken();
    expect(token).toMatch(/^cp_live_/);
  });

  it('has correct length (cp_live_ + 48 hex chars = 56 chars)', () => {
    const token = generateApiToken();
    expect(token).toHaveLength(56);
  });

  it('suffix is valid hex', () => {
    const token = generateApiToken();
    const suffix = token.slice(8);
    expect(suffix).toMatch(/^[0-9a-f]{48}$/);
  });

  it('generates unique tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateApiToken()));
    expect(tokens.size).toBe(100);
  });
});
