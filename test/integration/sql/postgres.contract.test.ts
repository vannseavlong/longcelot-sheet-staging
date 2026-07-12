import { Pool } from 'pg';
import { nanoid } from 'nanoid';
import { createPostgresAdapter } from '../../../src/adapter/sql/postgresAdapter';
import type { SQLAdapterBase } from '../../../src/adapter/sql/sqlAdapterBase';
import { generateSQLTable } from '../../../src/cli/commands/migrate';
import { contractSchemas, contractPermissions } from '../../../tests/contract/schemas';
import { runContractSuite, ContractSuiteFactory } from '../../../tests/contract/runContractSuite';

/**
 * Opt-in — requires a reachable Postgres instance. Not part of the default `pnpm test` run
 * (matches this repo's own CI, which stays build/test/lint/publish only — see TODO.md Phase
 * 16.7's scoping note); this is the "real database" arm of the Phase 16.4 contract suite, run
 * manually during development against a throwaway container, e.g.:
 *
 *   docker run --rm -d --name lsdb-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb \
 *     -p 55432:5432 postgres:16
 *   RUN_SQL_INTEGRATION_TESTS=1 pnpm test -- postgres.contract
 */
const CONNECTION_STRING = process.env.POSTGRES_TEST_URL ?? 'postgres://postgres:test@localhost:55432/testdb';
const RUN = process.env.RUN_SQL_INTEGRATION_TESTS === '1';

if (!RUN) {
  describe('DatabaseAdapter contract — Postgres (real database)', () => {
    it.skip('set RUN_SQL_INTEGRATION_TESTS=1 (and a reachable Postgres at $POSTGRES_TEST_URL) to run this suite', () => {});
  });
} else {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: CONNECTION_STRING });
    await pool.query('DROP TABLE IF EXISTS reviews CASCADE');
    await pool.query('DROP TABLE IF EXISTS notes CASCADE');
    await pool.query('DROP TABLE IF EXISTS products CASCADE');
    await pool.query('DROP TABLE IF EXISTS settings CASCADE');
    for (const schema of contractSchemas) {
      await pool.query(generateSQLTable(schema));
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  const factory: ContractSuiteFactory = {
    createAdapter() {
      const adapter: SQLAdapterBase = createPostgresAdapter({ pool, permissions: contractPermissions });
      adapter.registerSchemas(contractSchemas);
      return adapter;
    },
    uniqueId() {
      return nanoid(8);
    },
  };

  runContractSuite('Postgres (real database)', factory);
}
