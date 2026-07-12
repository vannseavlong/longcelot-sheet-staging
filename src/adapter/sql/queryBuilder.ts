import { WhereClause } from '../../schema/types';
import { SQLDialect } from './dialect';

export interface BuiltQuery {
  text: string;
  params: unknown[];
}

/** Tenant-scoping column/value pair — see accessControl.ts / FAQ.md #13 for what this generalizes. */
export interface TenantScope {
  column: string;
  value: string;
}

interface WhereOptions {
  where?: WhereClause;
  tenant?: TenantScope;
  softDeleteColumn?: string;
  includeDeleted?: boolean;
}

function coerceParam(dialect: SQLDialect, value: unknown): unknown {
  return typeof value === 'boolean' ? dialect.booleanLiteral(value) : value;
}

/**
 * `WhereClause` (schema/types.ts) is an equality-map today — matching CRUDOperations'
 * `matchesWhere()` semantics — so every condition here is a plain `AND`-chained `col = $n`.
 */
function buildWhereClause(
  dialect: SQLDialect,
  options: WhereOptions,
  startIndex: number
): { clause: string; params: unknown[]; nextIndex: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = startIndex;

  if (options.tenant) {
    conditions.push(`${dialect.quoteIdent(options.tenant.column)} = ${dialect.placeholder(idx++)}`);
    params.push(options.tenant.value);
  }

  if (options.softDeleteColumn && !options.includeDeleted) {
    conditions.push(`${dialect.quoteIdent(options.softDeleteColumn)} IS NULL`);
  }

  if (options.where) {
    for (const [key, value] of Object.entries(options.where)) {
      conditions.push(`${dialect.quoteIdent(key)} = ${dialect.placeholder(idx++)}`);
      params.push(coerceParam(dialect, value));
    }
  }

  return { clause: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', params, nextIndex: idx };
}

export function buildSelect(
  dialect: SQLDialect,
  table: string,
  options: WhereOptions & { orderBy?: string; order?: 'asc' | 'desc'; limit?: number; offset?: number }
): BuiltQuery {
  const { clause, params } = buildWhereClause(dialect, options, 1);
  let text = `SELECT * FROM ${dialect.quoteIdent(table)}${clause}`;
  if (options.orderBy) {
    text += ` ORDER BY ${dialect.quoteIdent(options.orderBy)} ${options.order === 'desc' ? 'DESC' : 'ASC'}`;
  }
  const limitOffset = dialect.limitOffsetClause(options.limit, options.offset);
  if (limitOffset) text += ` ${limitOffset}`;
  return { text, params };
}

export function buildCount(dialect: SQLDialect, table: string, options: WhereOptions): BuiltQuery {
  const { clause, params } = buildWhereClause(dialect, options, 1);
  return { text: `SELECT COUNT(*) AS count FROM ${dialect.quoteIdent(table)}${clause}`, params };
}

export function buildInsert(dialect: SQLDialect, table: string, row: Record<string, unknown>): BuiltQuery {
  const columns = Object.keys(row);
  const params = columns.map((col) => coerceParam(dialect, row[col]));
  const placeholders = columns.map((_col, i) => dialect.placeholder(i + 1));
  const text = `INSERT INTO ${dialect.quoteIdent(table)} (${columns
    .map((c) => dialect.quoteIdent(c))
    .join(', ')}) VALUES (${placeholders.join(', ')})`;
  return { text, params };
}

export function buildInsertMany(
  dialect: SQLDialect,
  table: string,
  rows: Record<string, unknown>[]
): BuiltQuery {
  if (rows.length === 0) return { text: '', params: [] };
  const columns = Object.keys(rows[0]);
  const params: unknown[] = [];
  let idx = 1;
  const valueGroups = rows.map((row) => {
    const placeholders = columns.map((col) => {
      params.push(coerceParam(dialect, row[col]));
      return dialect.placeholder(idx++);
    });
    return `(${placeholders.join(', ')})`;
  });
  const text = `INSERT INTO ${dialect.quoteIdent(table)} (${columns
    .map((c) => dialect.quoteIdent(c))
    .join(', ')}) VALUES ${valueGroups.join(', ')}`;
  return { text, params };
}

/**
 * No soft-delete filtering here — matches CRUDOperations.update(), which scans/updates
 * regardless of `_deleted_at` (only findMany/findOne/count exclude soft-deleted rows by default).
 */
export function buildUpdate(
  dialect: SQLDialect,
  table: string,
  data: Record<string, unknown>,
  where: WhereClause,
  tenant?: TenantScope
): BuiltQuery {
  const setColumns = Object.keys(data);
  const setParams = setColumns.map((col) => coerceParam(dialect, data[col]));
  let idx = 1;
  const setClause = setColumns.map((col) => `${dialect.quoteIdent(col)} = ${dialect.placeholder(idx++)}`).join(', ');

  const { clause, params: whereParams } = buildWhereClause(dialect, { where, tenant }, idx);
  const text = `UPDATE ${dialect.quoteIdent(table)} SET ${setClause}${clause}`;
  return { text, params: [...setParams, ...whereParams] };
}

/** Real hard delete — only used when schema.softDelete is false; soft-delete routes through buildUpdate. */
export function buildDelete(
  dialect: SQLDialect,
  table: string,
  where: WhereClause,
  tenant?: TenantScope
): BuiltQuery {
  const { clause, params } = buildWhereClause(dialect, { where, tenant }, 1);
  return { text: `DELETE FROM ${dialect.quoteIdent(table)}${clause}`, params };
}
