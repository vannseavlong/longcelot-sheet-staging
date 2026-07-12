import { ValidationError } from '../../errors/ValidationError';
import { SQLDialect } from './dialect';

/**
 * SQLTableOperations pre-checks uniqueness/FK constraints before writing (matching
 * CRUDOperations' behavior exactly), but a real DB is subject to concurrent-write races that
 * Sheets' effectively-serialized API mostly isn't. Once the DDL fidelity fixes (Phase 16.5)
 * make generateSQLTable() emit real UNIQUE/FOREIGN KEY constraints, a race can still reach the
 * database and get rejected natively — this translates that native rejection back into the same
 * ValidationError type the pre-check produces, so application error-handling code never has to
 * branch on which layer caught the problem. See FAQ.md #13 for why this is a deliberate
 * strengthening over Sheets' behavior, not a semantic mismatch.
 */
export function translateNativeError(err: unknown, dialect: SQLDialect): ValidationError | null {
  if (dialect.isUniqueViolation(err)) {
    return new ValidationError(`Unique constraint violation: ${extractDetail(err)}`);
  }
  if (dialect.isFKViolation(err)) {
    return new ValidationError(`FK violation: ${extractDetail(err)}`);
  }
  return null;
}

function extractDetail(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    if (typeof e.detail === 'string') return e.detail; // pg
    if (typeof e.sqlMessage === 'string') return e.sqlMessage; // mysql2
    if (typeof e.message === 'string') return e.message;
  }
  return 'constraint violation';
}
