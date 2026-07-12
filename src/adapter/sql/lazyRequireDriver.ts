import { SchemaError } from '../../errors/SchemaError';

/**
 * `pg`/`mysql2` are optional peerDependencies — this is the one place the "require it, or throw
 * a clear install hint instead of a cryptic module-not-found" pattern lives, reused by
 * createPostgresAdapter()/createMySQLAdapter() and by `lsdb migrate --apply` (Phase 16.7) rather
 * than each duplicating the try/catch.
 */
export function lazyRequireDriver<T>(moduleName: string, npmPackage: string, requiredBy: string): T {
  try {
    return require(moduleName) as T;
  } catch {
    throw new SchemaError(`${requiredBy} requires the '${npmPackage}' package. Install it with: npm install ${npmPackage}`);
  }
}
