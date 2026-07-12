/**
 * Storage-agnostic query surface both the Postgres and MySQL adapters normalize their
 * respective driver's pool down to, so SQLTableOperations (Phase 16.2) never touches `pg`/
 * `mysql2` directly. `pg.Pool.query()` already returns `{ rows }`; `mysql2/promise`'s pool
 * returns a `[rows, fields]` tuple — PgConnection/MySQLConnection (in postgresAdapter.ts/
 * mysqlAdapter.ts, next to the lazy `require()` of each driver) adapt both into this shape.
 */
export interface SQLQueryResult {
  rows: Record<string, unknown>[];
}

export interface SQLConnection {
  query(text: string, params: unknown[]): Promise<SQLQueryResult>;
}
