import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

// bcrypt silently truncates the input at 72 bytes — anything past that contributes nothing to the
// hash, so two different passwords sharing the same first 72 bytes hash identically. hashPassword()
// rejects longer input rather than silently accepting a weaker guarantee than "the whole password
// matters".
const BCRYPT_MAX_BYTES = 72;

function assertHashablePassword(password: string): void {
  if (Buffer.byteLength(password, 'utf-8') > BCRYPT_MAX_BYTES) {
    throw new Error(`Password exceeds bcrypt's ${BCRYPT_MAX_BYTES}-byte limit — reject or pre-hash (e.g. SHA-256) before calling hashPassword()`);
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertHashablePassword(password);
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (Buffer.byteLength(password, 'utf-8') > BCRYPT_MAX_BYTES) {
    errors.push(`Password must be at most ${BCRYPT_MAX_BYTES} bytes long`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
