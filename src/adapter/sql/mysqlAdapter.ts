import { ActorPermission } from '../../schema/types';
import { SQLConnection, SQLQueryResult } from './connection';
import { MySQLDialect } from './dialect';
import { SQLAdapterBase } from './sqlAdapterBase';
import { lazyRequireDriver } from './lazyRequireDriver';

export interface MySQLAdapterConfig {
  /** e.g. mysql://user:pass@host:3306/db. Ignored if `pool` is provided. Falls back to $DATABASE_URL. */
  connectionString?: string;
  /** Pass a pre-built mysql2/promise pool instead of letting this adapter construct one. */
  pool?: unknown;
  /** Column injected into every non-admin table to scope rows to a tenant. Default: 'tenant_id'. */
  tenantColumn?: string;
  permissions?: Record<string, ActorPermission>;
}

interface MySQLPoolLike {
  query(text: string, params: unknown[]): Promise<[unknown, unknown]>;
}

class MySQLConnection implements SQLConnection {
  constructor(private pool: MySQLPoolLike) {}

  async query(text: string, params: unknown[]): Promise<SQLQueryResult> {
    const [rows] = await this.pool.query(text, params);
    return { rows: rows as Record<string, unknown>[] };
  }
}

/**
 * `mysql2` is an optional peer dependency, lazy-required only here — see postgresAdapter.ts's
 * matching comment for why (Phase 16.2). Uses the `mysql2/promise` entry point since
 * SQLConnection.query() is promise-based.
 */
export function createMySQLAdapter(config: MySQLAdapterConfig): SQLAdapterBase {
  let pool: MySQLPoolLike;

  if (config.pool) {
    pool = config.pool as MySQLPoolLike;
  } else {
    const mysqlModule = lazyRequireDriver<{ createPool: (opts: { uri?: string }) => MySQLPoolLike }>(
      'mysql2/promise',
      'mysql2',
      'createMySQLAdapter()'
    );
    pool = mysqlModule.createPool({ uri: config.connectionString ?? process.env.DATABASE_URL });
  }

  return new SQLAdapterBase(new MySQLConnection(pool), MySQLDialect, {
    tenantColumn: config.tenantColumn,
    permissions: config.permissions,
  });
}
