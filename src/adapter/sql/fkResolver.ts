import { TableSchema, FKResolver } from '../../schema/types';
import { SchemaError } from '../../errors/SchemaError';
import { AccessControlContext, resolveNonAdminTenantKey } from '../accessControl';
import { SQLConnection } from './connection';
import { SQLDialect } from './dialect';
import { buildCount, TenantScope } from './queryBuilder';

/**
 * Tenant-scoped equivalent of SheetAdapter.createFKResolver(). That resolver checks the
 * referenced row within the *current context's* spreadsheet, so a same-actor FK stays inside
 * one tenant's sheet rather than checking globally — this must do the identical thing via
 * resolveNonAdminTenantKey(), or FK checks silently become cross-tenant existence leaks
 * (see FAQ.md #13).
 */
export function createSQLFKResolver(
  connection: SQLConnection,
  dialect: SQLDialect,
  schemas: Map<string, TableSchema>,
  tenantColumn: string,
  context: AccessControlContext | undefined
): FKResolver {
  return async (tableName: string, columnName: string, value: unknown): Promise<boolean> => {
    const refSchema = schemas.get(tableName);
    if (!refSchema) {
      throw new SchemaError(`Referenced table '${tableName}' is not registered`, tableName);
    }

    const tenant: TenantScope | undefined =
      refSchema.actor === 'admin' ? undefined : { column: tenantColumn, value: resolveNonAdminTenantKey(refSchema, context) };

    const { text, params } = buildCount(dialect, refSchema.name, {
      where: { [columnName]: value },
      tenant,
    });
    const result = await connection.query(text, params);
    const count = Number(result.rows[0]?.count ?? 0);
    return count > 0;
  };
}
