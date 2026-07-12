import { ActorPermission } from '../../schema/types';
import { SQLConnection, SQLQueryResult } from './connection';
import { PostgresDialect } from './dialect';
import { SQLAdapterBase } from './sqlAdapterBase';
import { lazyRequireDriver } from './lazyRequireDriver';

export interface PostgresAdapterConfig {
  /** e.g. postgres://user:pass@host:5432/db. Ignored if `pool` is provided. Falls back to $DATABASE_URL. */
  connectionString?: string;
  /** Pass a pre-built pg.Pool instead of letting this adapter construct one. */
  pool?: unknown;
  /** Column injected into every non-admin table to scope rows to a tenant. Default: 'tenant_id'. */
  tenantColumn?: string;
  permissions?: Record<string, ActorPermission>;
}

interface PgPoolLike {
  query(text: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

class PgConnection implements SQLConnection {
  constructor(private pool: PgPoolLike) {}

  async query(text: string, params: unknown[]): Promise<SQLQueryResult> {
    const result = await this.pool.query(text, params);
    return { rows: result.rows };
  }
}

/**
 * `pg` is an optional peer dependency, lazy-required only here so `import { createSheetAdapter }
 * from 'longcelot-sheet-db'` never pulls it in transitively for consumers who only use Sheets
 * (Phase 16.2). Throws a clear SchemaError — not a raw module-not-found — when it's missing.
 */
export function createPostgresAdapter(config: PostgresAdapterConfig): SQLAdapterBase {
  let pool: PgPoolLike;

  if (config.pool) {
    pool = config.pool as PgPoolLike;
  } else {
    const pgModule = lazyRequireDriver<{ Pool: new (opts: { connectionString?: string }) => PgPoolLike }>(
      'pg',
      'pg',
      'createPostgresAdapter()'
    );
    pool = new pgModule.Pool({ connectionString: config.connectionString ?? process.env.DATABASE_URL });
  }

  return new SQLAdapterBase(new PgConnection(pool), PostgresDialect, {
    tenantColumn: config.tenantColumn,
    permissions: config.permissions,
  });
}
