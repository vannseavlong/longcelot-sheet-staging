/**
 * The small set of syntactic differences SQLTableOperations needs to stay dialect-agnostic:
 * placeholder style, identifier quoting, boolean literal representation, LIMIT/OFFSET syntax,
 * and native constraint-violation classification (for errorTranslation.ts, Phase 16.2 decision 3).
 */
export interface SQLDialect {
  name: 'postgres' | 'mysql';
  quoteIdent(name: string): string;
  placeholder(index: number): string;
  booleanLiteral(value: boolean): unknown;
  limitOffsetClause(limit?: number, offset?: number): string;
  isUniqueViolation(err: unknown): boolean;
  isFKViolation(err: unknown): boolean;
}

function errorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  return String((err as { code: unknown }).code);
}

export const PostgresDialect: SQLDialect = {
  name: 'postgres',
  quoteIdent: (name) => `"${name.replace(/"/g, '""')}"`,
  placeholder: (index) => `$${index}`,
  booleanLiteral: (value) => value,
  limitOffsetClause: (limit, offset) => {
    const parts: string[] = [];
    if (limit !== undefined) parts.push(`LIMIT ${limit}`);
    if (offset !== undefined) parts.push(`OFFSET ${offset}`);
    return parts.join(' ');
  },
  // https://www.postgresql.org/docs/current/errcodes-appendix.html
  isUniqueViolation: (err) => errorCode(err) === '23505',
  isFKViolation: (err) => errorCode(err) === '23503',
};

export const MySQLDialect: SQLDialect = {
  name: 'mysql',
  quoteIdent: (name) => `\`${name.replace(/`/g, '``')}\``,
  placeholder: () => '?',
  booleanLiteral: (value) => (value ? 1 : 0),
  limitOffsetClause: (limit, offset) => {
    if (limit === undefined && offset === undefined) return '';
    // MySQL's LIMIT/OFFSET requires a LIMIT to use OFFSET; use MySQL's own documented
    // "effectively unlimited" sentinel when only an offset was requested.
    const effectiveLimit = limit ?? 18446744073709551615;
    const parts = [`LIMIT ${effectiveLimit}`];
    if (offset !== undefined) parts.push(`OFFSET ${offset}`);
    return parts.join(' ');
  },
  isUniqueViolation: (err) => errorCode(err) === 'ER_DUP_ENTRY',
  isFKViolation: (err) =>
    errorCode(err) === 'ER_NO_REFERENCED_ROW' ||
    errorCode(err) === 'ER_NO_REFERENCED_ROW_2' ||
    errorCode(err) === 'ER_ROW_IS_REFERENCED' ||
    errorCode(err) === 'ER_ROW_IS_REFERENCED_2',
};
