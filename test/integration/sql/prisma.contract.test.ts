import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { generatePrismaModel, collectPrismaBackRelations } from '../../../src/cli/commands/migrate';
import { createPrismaAdapter, PrismaAdapterBase } from '../../../src/adapter/sql/prismaAdapter';
import { contractSchemas, contractPermissions } from '../../../tests/contract/schemas';
import { runContractSuite, ContractSuiteFactory } from '../../../tests/contract/runContractSuite';

/**
 * Opt-in — requires a reachable Postgres instance and the `prisma`/`@prisma/client` CLI+library
 * (devDependencies here, purely for this test — createPrismaAdapter() itself never requires
 * them, see PrismaAdapterConfig). Fully self-contained: generates schema.prisma from
 * tests/contract/schemas.ts using this package's own generatePrismaModel(), shells out to
 * `prisma generate` + `prisma db push`, then runs the same cross-adapter contract suite as
 * postgres.contract.test.ts / mysql.contract.test.ts. Run manually during development:
 *
 *   docker run --rm -d --name lsdb-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb \
 *     -p 55432:5432 postgres:16
 *   RUN_SQL_INTEGRATION_TESTS=1 pnpm test -- prisma.contract
 */
const CONNECTION_STRING = process.env.POSTGRES_TEST_URL ?? 'postgres://postgres:test@localhost:55432/testdb';
const RUN = process.env.RUN_SQL_INTEGRATION_TESTS === '1';
const SCHEMA_DIR = path.join(__dirname, 'prisma');
const SCHEMA_PATH = path.join(SCHEMA_DIR, 'schema.prisma');

if (!RUN) {
  describe('DatabaseAdapter contract — Prisma (real database)', () => {
    it.skip('set RUN_SQL_INTEGRATION_TESTS=1 (and a reachable Postgres at $POSTGRES_TEST_URL) to run this suite', () => {});
  });
} else {
  jest.setTimeout(60000); // `prisma generate`/`db push` are slower than Jest's 5s default

  interface PrismaClientLike {
    $disconnect(): Promise<void>;
  }

  let client: PrismaClientLike;

  beforeAll(() => {
    const backRelations = collectPrismaBackRelations(contractSchemas);
    const header = [
      'generator client {',
      '  provider = "prisma-client-js"',
      '  output   = "./generated"',
      '}',
      '',
      'datasource db {',
      '  provider = "postgresql"',
      '  url      = env("DATABASE_URL")',
      '}',
      '',
    ].join('\n');
    const models = contractSchemas
      .map((schema) => generatePrismaModel(schema, { backRelations: backRelations.get(schema.name) }))
      .join('\n');

    fs.mkdirSync(SCHEMA_DIR, { recursive: true });
    fs.writeFileSync(SCHEMA_PATH, header + models);

    const env = { ...process.env, DATABASE_URL: CONNECTION_STRING, PRISMA_HIDE_UPDATE_MESSAGE: '1' };
    execSync(`npx prisma generate --schema="${SCHEMA_PATH}"`, { env, stdio: 'pipe' });
    execSync(`npx prisma db push --schema="${SCHEMA_PATH}" --skip-generate --accept-data-loss --force-reset`, {
      env,
      stdio: 'pipe',
    });

    // The generated client reads env("DATABASE_URL") again at query time, not just at
    // generate-time — passing DATABASE_URL only to the execSync() child processes above isn't
    // enough, it must also be set on this Jest process itself before constructing the client.
    process.env.DATABASE_URL = CONNECTION_STRING;

    const generated = require('./prisma/generated') as { PrismaClient: new () => PrismaClientLike };
    client = new generated.PrismaClient();
  });

  afterAll(async () => {
    await client?.$disconnect();
  });

  const factory: ContractSuiteFactory = {
    createAdapter() {
      const adapter: PrismaAdapterBase = createPrismaAdapter({ client, permissions: contractPermissions });
      adapter.registerSchemas(contractSchemas);
      return adapter;
    },
    uniqueId() {
      return nanoid(8);
    },
  };

  runContractSuite('Prisma (real database)', factory);
}
