import mysql from 'mysql2/promise';
import { nanoid } from 'nanoid';
import { createMySQLAdapter } from '../../../src/adapter/sql/mysqlAdapter';
import type { SQLAdapterBase } from '../../../src/adapter/sql/sqlAdapterBase';
import { generateSQLTable } from '../../../src/cli/commands/migrate';
import { contractSchemas, contractPermissions } from '../../../tests/contract/schemas';
import { runContractSuite, ContractSuiteFactory } from '../../../tests/contract/runContractSuite';

/**
 * Opt-in — requires a reachable MySQL instance. See postgres.contract.test.ts for the rationale
 * (not part of the default `pnpm test` run). Run manually during development, e.g.:
 *
 *   docker run --rm -d --name lsdb-test-mysql -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=testdb \
 *     -p 53306:3306 mysql:8
 *   RUN_SQL_INTEGRATION_TESTS=1 pnpm test -- mysql.contract
 */
const CONNECTION_STRING = process.env.MYSQL_TEST_URL ?? 'mysql://root:test@localhost:53306/testdb';
const RUN = process.env.RUN_SQL_INTEGRATION_TESTS === '1';

if (!RUN) {
  describe('DatabaseAdapter contract — MySQL (real database)', () => {
    it.skip('set RUN_SQL_INTEGRATION_TESTS=1 (and a reachable MySQL at $MYSQL_TEST_URL) to run this suite', () => {});
  });
} else {
  let pool: mysql.Pool;

  beforeAll(async () => {
    const setupConn = await mysql.createConnection(`${CONNECTION_STRING}?multipleStatements=true`);
    await setupConn.query('SET FOREIGN_KEY_CHECKS = 0');
    await setupConn.query('DROP TABLE IF EXISTS reviews');
    await setupConn.query('DROP TABLE IF EXISTS notes');
    await setupConn.query('DROP TABLE IF EXISTS products');
    await setupConn.query('DROP TABLE IF EXISTS settings');
    await setupConn.query('SET FOREIGN_KEY_CHECKS = 1');
    for (const schema of contractSchemas) {
      await setupConn.query(generateSQLTable(schema));
    }
    await setupConn.end();

    pool = mysql.createPool(CONNECTION_STRING);
  });

  afterAll(async () => {
    await pool.end();
  });

  const factory: ContractSuiteFactory = {
    createAdapter() {
      const adapter: SQLAdapterBase = createMySQLAdapter({ pool, permissions: contractPermissions });
      adapter.registerSchemas(contractSchemas);
      return adapter;
    },
    uniqueId() {
      return nanoid(8);
    },
  };

  runContractSuite('MySQL (real database)', factory);
}
