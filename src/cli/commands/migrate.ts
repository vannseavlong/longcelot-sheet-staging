import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { TableSchema, ColumnDefinition } from '../../schema/types';
import { resolveActorName } from '../../utils/actorConfig';
import { resolveConfigPath } from '../../utils/cliFiles';
import { toPrismaFieldName } from '../../utils/prismaNaming';
import { lazyRequireDriver } from '../../adapter/sql/lazyRequireDriver';

interface MigrateOptions {
  prisma?: boolean;
  sql?: boolean;
  output?: string;
  /** Apply the generated DDL (--sql) to a live database, or run `prisma migrate deploy` (--prisma). Phase 16.7. */
  apply?: boolean;
  connectionString?: string;
  driver?: 'postgres' | 'mysql';
  dryRun?: boolean;
}

function mapTypeToPrisma(col: ColumnDefinition): string {
  switch (col.type) {
    case 'string':  return 'String';
    case 'number':  return 'Float';
    case 'boolean': return 'Boolean';
    case 'date':    return 'DateTime';
    case 'json':    return 'Json';
    default:        return 'String';
  }
}

function mapTypeToSQL(col: ColumnDefinition): string {
  switch (col.type) {
    case 'string':  return 'VARCHAR(255)';
    case 'number':  return 'DECIMAL(10,2)';
    case 'boolean': return 'BOOLEAN';
    case 'date':    return 'TIMESTAMP'; // valid on both Postgres and MySQL — DATETIME is MySQL-only, Postgres has no such type
    case 'json':    return 'JSON';
    default:        return 'VARCHAR(255)';
  }
}

/** Formats a default/enum value as a SQL literal for the given column type. Used by both
 *  DEFAULT ... and CHECK (col IN (...)) — both need the same literal-quoting rules. */
function formatSQLValue(value: unknown, type: ColumnDefinition['type']): string {
  if (value === null || value === undefined) return 'NULL';
  if (type === 'boolean' && typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (type === 'number' && typeof value === 'number') return String(value);
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

function toPrismaEnumName(schemaName: string, colName: string): string {
  const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${pascal(schemaName)}${pascal(colName)}Enum`;
}

/** Prisma's native `enum` blocks are string-identifier-only — ColumnDefinition.enum isn't, so a
 *  non-string or non-identifier-safe enum falls back to a doc-comment instead of a broken file. */
function isPrismaEnumSafe(values: (string | number | boolean)[]): values is string[] {
  return values.every((v) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(v));
}

export interface DDLOptions {
  /** Column injected into every non-admin table to scope rows to a tenant (Phase 16.3 ADR — see FAQ.md #13). Default: 'tenant_id'. */
  tenantColumn?: string;
  /**
   * Back-relation fields to append to this model — Prisma requires every explicit `@relation`
   * to have a matching field on *both* sides ("missing an opposite relation field", found via
   * real `prisma generate`, Phase 16.2). generatePrismaModel() only sees one schema at a time,
   * so it can't discover these itself — pass the result of collectPrismaBackRelations(schemas).
   */
  backRelations?: PrismaBackRelation[];
}

export interface PrismaBackRelation {
  /** Field name to add on the referenced model, e.g. 'reviews_product_id_rel'. */
  fieldName: string;
  /** The referencing model's name, e.g. 'reviews'. */
  sourceModel: string;
}

/**
 * One pass over every schema, collecting — per referenced table — the list of back-relation
 * fields it needs so each `ref()` column's forward `@relation` has a matching opposite field.
 * Field names include both the source model and column name (not just the source model) so two
 * FK columns from the same table to the same target don't collide.
 */
export function collectPrismaBackRelations(schemas: TableSchema[]): Map<string, PrismaBackRelation[]> {
  const map = new Map<string, PrismaBackRelation[]>();
  for (const schema of schemas) {
    for (const colName of Object.keys(schema.columns)) {
      const col = schema.columns[colName];
      if (!col.ref) continue;
      const [refTable] = col.ref.split('.');
      const existing = map.get(refTable) ?? [];
      existing.push({ fieldName: `${schema.name}_${colName}_rel`, sourceModel: schema.name });
      map.set(refTable, existing);
    }
  }
  return map;
}

export function generatePrismaModel(schema: TableSchema, options: DDLOptions = {}): string {
  const tenantColumn = options.tenantColumn ?? 'tenant_id';
  const pkCol = schema.pkColumn ?? '_id';
  const isTenantScoped = schema.actor !== 'admin';
  const enumBlocks: string[] = [];
  const indexFields: string[] = [];
  const compositeUniqueFields: string[] = [];
  const lines: string[] = [`model ${schema.name} {`];

  for (const [colName, col] of Object.entries(schema.columns)) {
    let prismaType = mapTypeToPrisma(col);
    const isOptional = !col.required && !col.primary;
    const typeSuffix = isOptional ? '?' : '';
    const annotations: string[] = [];
    // Prisma field names can't start with '_' (a hard parse error) — every schema has `_id`
    // (defineTable() injects it unconditionally), so this isn't an edge case. The Prisma field
    // uses the stripped name; @map() preserves the real, unchanged column name underneath. See
    // toPrismaFieldName() (utils/prismaNaming.ts) for the incident this fixes (Phase 16.2).
    const fieldName = toPrismaFieldName(colName);
    if (fieldName !== colName) annotations.push(`@map("${colName}")`);

    // @id annotation
    if (colName === pkCol) {
      annotations.push('@id');
      if (col.type === 'string') {
        annotations.push('@default(cuid())');
      }
    }

    // Tenant-scoped tables: uniqueness is per-tenant (matches SQLTableOperations/
    // PrismaTableOperations' checkUniqueness(), which checks via a tenant-scoped findOne()) — a
    // bare @unique would instead enforce uniqueness globally across every tenant at the Prisma/DB
    // level (found via real `prisma db push` + a duplicate-across-tenants test, Phase 16.2/16.4 —
    // same bug class as generateSQLTable()'s composite UNIQUE fix, see FAQ.md #13). Emitted as a
    // composite `@@unique([tenant_id, field])` below instead. Admin tables have no tenant column
    // at all, so a plain field-level @unique is correct there.
    if (col.unique && colName !== pkCol) {
      if (isTenantScoped) {
        compositeUniqueFields.push(fieldName);
      } else {
        annotations.push('@unique');
      }
    }

    if (col.index) {
      indexFields.push(fieldName);
    }

    if (col.enum) {
      if (isPrismaEnumSafe(col.enum)) {
        const enumName = toPrismaEnumName(schema.name, colName);
        enumBlocks.push(`enum ${enumName} {\n${col.enum.map((v) => `  ${v}`).join('\n')}\n}\n`);
        prismaType = enumName;
      } else {
        lines.push(`  /// Allowed values: ${col.enum.join(' | ')}`);
      }
    }

    // FK columns: the scalar field carries no @relation of its own — Prisma attaches exactly
    // one @relation attribute per relation, on the object-typed relation field below. Putting
    // @relation on both was invalid Prisma syntax (found via real `prisma generate`, Phase 16.2).
    // `fields`/`references` both take Prisma FIELD names, not raw column names — the referenced
    // column goes through the same leading-underscore strip as this model's own columns.
    if (col.ref) {
      const [refTable, refCol] = col.ref.split('.');
      const annotationStr = annotations.length > 0 ? '  ' + annotations.join(' ') : '';
      lines.push(`  ${fieldName}  ${prismaType}${typeSuffix}${annotationStr}`);
      lines.push(
        `  ${refTable}_rel  ${refTable}  @relation(fields: [${fieldName}], references: [${toPrismaFieldName(refCol)}])`
      );
      continue;
    }

    const annotationStr = annotations.length > 0 ? '  ' + annotations.join(' ') : '';
    lines.push(`  ${fieldName}  ${prismaType}${typeSuffix}${annotationStr}`);
  }

  // Back-relation fields — see collectPrismaBackRelations() above for why these exist.
  for (const backRelation of options.backRelations ?? []) {
    lines.push(`  ${backRelation.fieldName}  ${backRelation.sourceModel}[]`);
  }

  // Tenant-scoping column for non-admin tables — see resolveNonAdminTenantKey() (accessControl.ts)
  // and FAQ.md #13 for what this generalizes from Sheets' per-user spreadsheet isolation.
  if (isTenantScoped) {
    lines.push(`  ${tenantColumn}  String`);
    indexFields.push(tenantColumn);
  }

  for (const fieldName of indexFields) {
    lines.push(`  @@index([${fieldName}])`);
  }

  for (const fieldName of compositeUniqueFields) {
    lines.push(`  @@unique([${tenantColumn}, ${fieldName}])`);
  }

  lines.push('}');
  lines.push('');
  return [...enumBlocks, lines.join('\n')].join('\n');
}

export function generateSQLTable(schema: TableSchema, options: DDLOptions = {}): string {
  const tenantColumn = options.tenantColumn ?? 'tenant_id';
  const pkCol = schema.pkColumn ?? '_id';
  const isTenantScoped = schema.actor !== 'admin';
  const lines: string[] = [`CREATE TABLE IF NOT EXISTS ${schema.name} (`];
  const columnLines: string[] = [];
  const constraintLines: string[] = [];
  const indexLines: string[] = [];

  for (const [colName, col] of Object.entries(schema.columns)) {
    const sqlType = mapTypeToSQL(col);
    const notNull = col.required || col.primary ? ' NOT NULL' : '';
    // Tenant-scoped tables: uniqueness is per-tenant (matches SQLTableOperations.checkUniqueness(),
    // which checks via a tenant-scoped findOne(), and Sheets' physical per-tenant sheet isolation —
    // see FAQ.md #13). A bare column-level UNIQUE would instead enforce uniqueness globally across
    // every tenant, so it's emitted as a composite UNIQUE(tenant_id, col) constraint below instead.
    // Admin tables have no tenant column at all, so a plain column UNIQUE is correct there.
    const inlineUnique = col.unique && colName !== pkCol && !isTenantScoped ? ' UNIQUE' : '';
    // MySQL 8.0.13+ rejects a bare literal DEFAULT on JSON columns (ER_BLOB_CANT_HAVE_DEFAULT) —
    // it must be a parenthesized expression instead. A parenthesized literal is also valid,
    // equivalent syntax on Postgres, so this is safe to do unconditionally for json columns.
    const defaultLiteral = col.default !== undefined ? formatSQLValue(col.default, col.type) : undefined;
    const defaultClause =
      defaultLiteral === undefined ? '' : col.type === 'json' ? ` DEFAULT (${defaultLiteral})` : ` DEFAULT ${defaultLiteral}`;
    const checkClause = col.enum
      ? ` CHECK (${colName} IN (${col.enum.map((v) => formatSQLValue(v, col.type)).join(', ')}))`
      : '';
    columnLines.push(`  ${colName} ${sqlType}${notNull}${inlineUnique}${defaultClause}${checkClause}`);

    if (col.unique && colName !== pkCol && isTenantScoped) {
      constraintLines.push(`  UNIQUE (${tenantColumn}, ${colName})`);
    }

    if (col.ref) {
      const [refTable, refCol] = col.ref.split('.');
      constraintLines.push(`  FOREIGN KEY (${colName}) REFERENCES ${refTable}(${refCol})`);
    }

    // Unlike CREATE TABLE, plain CREATE INDEX has no IF NOT EXISTS clause in MySQL at all (in any
    // version — confirmed via real-MySQL integration testing, Phase 16.2); Postgres supports it,
    // but since this DDL is meant to be portable, idempotency here is instead the `--apply`
    // command's job (Phase 16.7): catch-and-ignore the native "already exists" error on rerun.
    if (col.index) {
      indexLines.push(`CREATE INDEX idx_${schema.name}_${colName} ON ${schema.name}(${colName});`);
    }
  }

  // Tenant-scoping column for non-admin tables — mirrors generatePrismaModel() above.
  if (isTenantScoped) {
    columnLines.push(`  ${tenantColumn} VARCHAR(255) NOT NULL`);
    indexLines.push(`CREATE INDEX idx_${schema.name}_${tenantColumn} ON ${schema.name}(${tenantColumn});`);
  }

  // PRIMARY KEY constraint
  constraintLines.unshift(`  PRIMARY KEY (${pkCol})`);

  const allLines = [...columnLines, ...constraintLines];
  for (let i = 0; i < allLines.length; i++) {
    lines.push(allLines[i] + (i < allLines.length - 1 ? ',' : ''));
  }

  lines.push(');');
  lines.push('');

  if (indexLines.length > 0) {
    lines.push(...indexLines);
    lines.push('');
  }

  return lines.join('\n');
}

function loadSchemas(config: { actors: Array<{ name?: string; role?: string } | string> }): TableSchema[] {
  const schemas: TableSchema[] = [];
  const schemasDir = path.join(process.cwd(), 'schemas');

  for (const actorEntry of config.actors) {
    const actor = resolveActorName(actorEntry);
    const actorDir = path.join(schemasDir, actor);
    if (!fs.existsSync(actorDir)) continue;

    const files = fs.readdirSync(actorDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
    for (const file of files) {
      try {
        const schema = require(path.join(actorDir, file)).default;
        if (schema?.columns) schemas.push(schema);
      } catch {
        // skip unloadable files
      }
    }
  }

  return schemas;
}

export function inferDriverFromConnectionString(connectionString: string): 'postgres' | 'mysql' | undefined {
  if (connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://')) return 'postgres';
  if (connectionString.startsWith('mysql://')) return 'mysql';
  return undefined;
}

/**
 * Splits the multi-statement DDL text generateSQLTable() produces into individual statements so
 * --apply can execute (and idempotency-check) each one separately — needed because MySQL doesn't
 * run multi-statement query() calls without an extra multipleStatements connection flag we'd
 * rather not require. Known limitation: a semicolon inside a quoted default()/enum() string
 * value would be mis-split; not handled by this first-pass implementation.
 */
export function splitSQLStatements(ddl: string): string[] {
  return ddl
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => `${s};`);
}

/**
 * `CREATE TABLE IF NOT EXISTS` is already idempotent at the SQL level, but plain `CREATE INDEX`
 * has no such clause in MySQL (see generateSQLTable()'s comment) — so a rerun's only expected
 * failure is "index already exists", which --apply treats as success rather than an error.
 */
export function isAlreadyExistsError(err: unknown, driver: 'postgres' | 'mysql'): boolean {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
  // Postgres: 42P07 = duplicate_table (covers indexes too, same relation namespace).
  // MySQL: ER_DUP_KEYNAME = duplicate index/key name.
  return driver === 'postgres' ? code === '42P07' : code === 'ER_DUP_KEYNAME';
}

interface ApplyConnection {
  query(text: string): Promise<unknown>;
  end(): Promise<void>;
}

/** Reuses lazyRequireDriver() (also used by createPostgresAdapter()/createMySQLAdapter()) rather than a third copy of the try/catch. */
async function connectForApply(driver: 'postgres' | 'mysql', connectionString: string): Promise<ApplyConnection> {
  if (driver === 'postgres') {
    const pgModule = lazyRequireDriver<{
      Pool: new (opts: { connectionString: string }) => { query: (t: string) => Promise<unknown>; end: () => Promise<void> };
    }>('pg', 'pg', 'migrate --apply');
    const pool = new pgModule.Pool({ connectionString });
    return { query: (text) => pool.query(text), end: () => pool.end() };
  }

  const mysqlModule = lazyRequireDriver<{
    createConnection: (opts: { uri: string }) => Promise<{ query: (t: string) => Promise<unknown>; end: () => Promise<void> }>;
  }>('mysql2/promise', 'mysql2', 'migrate --apply');
  const conn = await mysqlModule.createConnection({ uri: connectionString });
  return { query: (text) => conn.query(text), end: () => conn.end() };
}

/** `--sql --apply`: execute generateSQLTable()'s output against a live database, statement by statement. */
export async function applySQLToDatabase(schemas: TableSchema[], options: MigrateOptions): Promise<void> {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(chalk.red('❌ --connection-string or $DATABASE_URL is required for --apply'));
    process.exit(1);
  }

  const driver = options.driver ?? inferDriverFromConnectionString(connectionString);
  if (!driver) {
    console.error(chalk.red('❌ Could not infer the driver from the connection string — pass --driver postgres|mysql explicitly.'));
    process.exit(1);
  }

  const statements = schemas.flatMap((schema) => splitSQLStatements(generateSQLTable(schema)));

  if (options.dryRun) {
    console.log(chalk.blue.bold(`\n🔎 Dry run — would apply ${statements.length} statement(s) to ${driver}:\n`));
    statements.forEach((s) => console.log(chalk.gray(s)));
    return;
  }

  console.log(chalk.blue.bold(`\n📦 Applying DDL for ${schemas.length} table(s) to ${driver}...\n`));
  const conn = await connectForApply(driver, connectionString);

  try {
    for (const statement of statements) {
      try {
        await conn.query(statement);
        console.log(chalk.green(`  ✅ ${statement.split('\n')[0].slice(0, 70)}`));
      } catch (err) {
        if (isAlreadyExistsError(err, driver)) {
          console.log(chalk.yellow(`  ⏭  already exists, skipped: ${statement.split('\n')[0].slice(0, 60)}`));
          continue;
        }
        throw err;
      }
    }
  } finally {
    await conn.end();
  }

  console.log(chalk.green(`\n✅ Applied schema to ${driver}`));
}

/**
 * `--prisma --apply`: shells out to `prisma migrate deploy`, per TODO.md's own suggestion.
 * Prerequisite: the consumer's Prisma project must already have a migrations/ folder (this
 * command doesn't generate migration history, only schema.prisma) — created by running
 * `npx prisma migrate dev` once locally, same as any normal Prisma project setup.
 */
function applyPrismaMigrateDeploy(schemaPath: string, options: MigrateOptions): void {
  if (options.dryRun) {
    console.log(chalk.blue.bold(`\n🔎 Dry run — would run: npx prisma migrate deploy --schema="${schemaPath}"`));
    return;
  }

  console.log(chalk.blue.bold('\n📦 Running prisma migrate deploy...\n'));
  try {
    const env = options.connectionString ? { ...process.env, DATABASE_URL: options.connectionString } : process.env;
    execSync(`npx prisma migrate deploy --schema="${schemaPath}"`, { stdio: 'inherit', env });
    console.log(chalk.green('\n✅ Prisma migrations applied'));
  } catch {
    console.error(
      chalk.red(
        '\n❌ prisma migrate deploy failed. Does a migrations/ folder exist next to this schema? ' +
          'Run `npx prisma migrate dev` once locally to create one.'
      )
    );
    process.exit(1);
  }
}

export async function migrateCommand(options: MigrateOptions) {
  console.log(chalk.blue.bold('📦 Exporting schemas...\n'));

  if (!options.prisma && !options.sql) {
    console.error(chalk.red('❌ Specify --prisma or --sql (or both)'));
    process.exit(1);
  }

  let config;
  try {
    config = require(resolveConfigPath()).default;
  } catch {
    console.error(chalk.red('❌ lsdb.config.ts not found'));
    process.exit(1);
  }

  const schemas = loadSchemas(config);

  if (schemas.length === 0) {
    console.log(chalk.yellow('⚠️  No schemas found'));
    return;
  }

  if (options.prisma) {
    const prismaHeader = [
      'generator client {',
      '  provider = "prisma-client-js"',
      '}',
      '',
      'datasource db {',
      '  provider = "postgresql"',
      '  url      = env("DATABASE_URL")',
      '}',
      '',
    ].join('\n');

    const backRelations = collectPrismaBackRelations(schemas);
    const models = schemas
      .map((schema) => generatePrismaModel(schema, { backRelations: backRelations.get(schema.name) }))
      .join('\n');
    const prismaOutput = prismaHeader + models;

    const outPath = options.output
      ? path.join(options.output, 'schema.prisma')
      : path.join(process.cwd(), 'schema.prisma');

    if (options.output && !fs.existsSync(options.output)) {
      fs.mkdirSync(options.output, { recursive: true });
    }

    fs.writeFileSync(outPath, prismaOutput);
    console.log(chalk.green(`✅ Prisma schema written to ${outPath}`));

    if (options.apply) {
      applyPrismaMigrateDeploy(outPath, options);
    }
  }

  if (options.sql) {
    const tables = schemas.map((schema) => generateSQLTable(schema)).join('\n');

    const outPath = options.output
      ? path.join(options.output, 'schema.sql')
      : path.join(process.cwd(), 'schema.sql');

    if (options.output && !fs.existsSync(options.output)) {
      fs.mkdirSync(options.output, { recursive: true });
    }

    fs.writeFileSync(outPath, tables);
    console.log(chalk.green(`✅ SQL DDL written to ${outPath}`));

    if (options.apply) {
      await applySQLToDatabase(schemas, options);
    }
  }

  console.log(chalk.cyan(`\nExported ${schemas.length} table(s)`));
}
