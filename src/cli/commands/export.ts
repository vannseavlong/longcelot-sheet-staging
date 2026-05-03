import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { TableSchema, ColumnDefinition } from '../../schema/types';

interface ExportOptions {
  prisma?: boolean;
  sql?: boolean;
  output?: string;
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
    case 'date':    return 'DATETIME';
    case 'json':    return 'JSON';
    default:        return 'VARCHAR(255)';
  }
}

function generatePrismaModel(schema: TableSchema): string {
  const lines: string[] = [`model ${schema.name} {`];

  for (const [colName, col] of Object.entries(schema.columns)) {
    const prismaType = mapTypeToPrisma(col);
    const isOptional = !col.required && !col.primary;
    const typeSuffix = isOptional ? '?' : '';
    const annotations: string[] = [];

    // @id annotation
    if (colName === (schema.pkColumn ?? '_id')) {
      annotations.push('@id');
      if (col.type === 'string') {
        annotations.push('@default(cuid())');
      }
    }

    // @unique annotation (skip if @id already added)
    if (col.unique && colName !== (schema.pkColumn ?? '_id')) {
      annotations.push('@unique');
    }

    // @relation annotation for FK columns
    if (col.ref) {
      const [refTable, refCol] = col.ref.split('.');
      annotations.push(`@relation(fields: [${colName}], references: [${refCol}])`);
      // Add a relation field after this column
      const annotationStr = annotations.length > 0 ? '  ' + annotations.join(' ') : '';
      lines.push(`  ${colName}  ${prismaType}${typeSuffix}${annotationStr}`);
      lines.push(`  ${refTable}_rel  ${refTable}  @relation(fields: [${colName}], references: [${refCol}])`);
      continue;
    }

    const annotationStr = annotations.length > 0 ? '  ' + annotations.join(' ') : '';
    lines.push(`  ${colName}  ${prismaType}${typeSuffix}${annotationStr}`);
  }

  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function generateSQLTable(schema: TableSchema): string {
  const lines: string[] = [`CREATE TABLE ${schema.name} (`];
  const columnLines: string[] = [];
  const constraintLines: string[] = [];

  for (const [colName, col] of Object.entries(schema.columns)) {
    const sqlType = mapTypeToSQL(col);
    const notNull = col.required || col.primary ? ' NOT NULL' : '';
    columnLines.push(`  ${colName} ${sqlType}${notNull}`);

    if (col.ref) {
      const [refTable, refCol] = col.ref.split('.');
      constraintLines.push(`  FOREIGN KEY (${colName}) REFERENCES ${refTable}(${refCol})`);
    }
  }

  // PRIMARY KEY constraint
  const pkCol = schema.pkColumn ?? '_id';
  constraintLines.unshift(`  PRIMARY KEY (${pkCol})`);

  const allLines = [...columnLines, ...constraintLines];
  for (let i = 0; i < allLines.length; i++) {
    lines.push(allLines[i] + (i < allLines.length - 1 ? ',' : ''));
  }

  lines.push(');');
  lines.push('');
  return lines.join('\n');
}

function loadSchemas(config: { actors: string[] }): TableSchema[] {
  const schemas: TableSchema[] = [];
  const schemasDir = path.join(process.cwd(), 'schemas');

  for (const actor of config.actors) {
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

export async function exportCommand(options: ExportOptions) {
  console.log(chalk.blue.bold('📦 Exporting schemas...\n'));

  if (!options.prisma && !options.sql) {
    console.error(chalk.red('❌ Specify --prisma or --sql (or both)'));
    process.exit(1);
  }

  let config;
  try {
    config = require(path.join(process.cwd(), 'sheet-db.config.ts')).default;
  } catch {
    console.error(chalk.red('❌ sheet-db.config.ts not found'));
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

    const models = schemas.map(generatePrismaModel).join('\n');
    const prismaOutput = prismaHeader + models;

    const outPath = options.output
      ? path.join(options.output, 'schema.prisma')
      : path.join(process.cwd(), 'schema.prisma');

    if (options.output && !fs.existsSync(options.output)) {
      fs.mkdirSync(options.output, { recursive: true });
    }

    fs.writeFileSync(outPath, prismaOutput);
    console.log(chalk.green(`✅ Prisma schema written to ${outPath}`));
  }

  if (options.sql) {
    const tables = schemas.map(generateSQLTable).join('\n');

    const outPath = options.output
      ? path.join(options.output, 'schema.sql')
      : path.join(process.cwd(), 'schema.sql');

    if (options.output && !fs.existsSync(options.output)) {
      fs.mkdirSync(options.output, { recursive: true });
    }

    fs.writeFileSync(outPath, tables);
    console.log(chalk.green(`✅ SQL DDL written to ${outPath}`));
  }

  console.log(chalk.cyan(`\nExported ${schemas.length} table(s)`));
}
