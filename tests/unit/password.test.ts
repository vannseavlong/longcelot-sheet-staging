import { hashPassword, validatePasswordStrength } from '../../src/auth/password';

describe('hashPassword — bcrypt 72-byte limit guard', () => {
  it('hashes a normal password', async () => {
    const hash = await hashPassword('Sup3rSecret!');
    expect(hash).toEqual(expect.any(String));
  });

  it('rejects a password longer than 72 bytes instead of silently truncating it', async () => {
    const tooLong = 'A1'.repeat(40); // 80 bytes
    await expect(hashPassword(tooLong)).rejects.toThrow(/72-byte/);
  });
});

describe('validatePasswordStrength', () => {
  it('flags a password over 72 bytes as invalid', () => {
    const tooLong = 'A1'.repeat(40);
    const result = validatePasswordStrength(tooLong);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('72 bytes'))).toBe(true);
  });

  it('accepts a normal strong password', () => {
    const result = validatePasswordStrength('Str0ngPass');
    expect(result.valid).toBe(true);
  });
});
