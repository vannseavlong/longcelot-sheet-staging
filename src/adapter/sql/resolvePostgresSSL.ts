/**
 * Managed Postgres providers (Render, Heroku, Supabase, etc.) require SSL on external
 * connections but present certs that aren't in Node's default trust store. A plain
 * `new Pool({ connectionString })` against one of these doesn't fail with a clear TLS
 * error — the server just drops the connection, which `pg` surfaces as the generic
 * "Connection terminated unexpectedly". Localhost/loopback connections (local dev,
 * docker-compose test databases) never need this and should be left alone.
 */
export function resolvePostgresSSL(
  connectionString: string | undefined,
  override?: boolean | { rejectUnauthorized: boolean }
): boolean | { rejectUnauthorized: boolean } | undefined {
  if (override !== undefined) return override;
  if (!connectionString) return undefined;
  if (/^postgres(ql)?:\/\/([^@]*@)?(localhost|127\.0\.0\.1)(:|\/|$)/.test(connectionString)) {
    return undefined;
  }
  return { rejectUnauthorized: false };
}
