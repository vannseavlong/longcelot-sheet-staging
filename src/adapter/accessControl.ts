import { TableSchema, ActorPermission } from '../schema/types';
import { PermissionError } from '../errors/PermissionError';

/**
 * Storage-agnostic version of SheetAdapter's context — enough to decide access and, for
 * non-admin schemas, resolve a tenant-scoping key. For SheetAdapter, actorSheetId/targetSheetId
 * are real spreadsheet IDs; for SQL adapters (Phase 16.2) they're opaque tenant_id values.
 */
export interface AccessControlContext {
  role: string;
  targetActor?: string;
  actorSheetId?: string;
  targetSheetId?: string;
}

/**
 * Cross-actor permission matrix enforcement — extracted verbatim from SheetAdapter's former
 * private hasPermission() (Phase 16.3) so a non-Sheets DatabaseAdapter enforces identical
 * semantics instead of reimplementing this branching logic.
 */
export function hasPermission(
  schema: Pick<TableSchema, 'actor' | 'name'>,
  context: AccessControlContext | undefined,
  permissions: Record<string, ActorPermission> | undefined
): boolean {
  if (!context) return false;

  if (context.role === 'admin') return true;

  // Same actor accessing their own tables
  if (schema.actor === context.role && !context.targetActor) return true;

  // Admin tables: non-admin cannot access unless it's the users table on create
  if (schema.actor === 'admin') return false;

  // Cross-actor: check permission matrix
  const targetActor = context.targetActor;
  if (!targetActor || targetActor === context.role) return schema.actor === context.role;

  if (schema.actor !== targetActor) return false;

  const perm = permissions?.[context.role];
  if (!perm) {
    throw new PermissionError(
      `'${context.role}' has no cross-actor permissions configured`,
      context.role
    );
  }

  if (!perm.canAccess.includes(targetActor)) {
    throw new PermissionError(
      `'${context.role}' cannot access '${targetActor}' sheets`,
      context.role
    );
  }

  if (perm.tables && !perm.tables.includes(schema.name)) {
    throw new PermissionError(
      `Table '${schema.name}' is not allowed for '${context.role}' → '${targetActor}' access`,
      context.role
    );
  }

  return true;
}

/**
 * Resolves the tenant-scoping key for a non-admin schema — extracted verbatim from
 * SheetAdapter's former private resolveSpreadsheetId() minus the admin branch (Phase 16.3).
 * Callers handle schema.actor === 'admin' themselves: "admin" means a fixed global store for
 * SheetAdapter (adminSheetId) but "no tenant filter at all" for SQL adapters, so there's no
 * single generic admin behavior to encode here.
 */
export function resolveNonAdminTenantKey(
  schema: Pick<TableSchema, 'actor'>,
  context: AccessControlContext | undefined
): string {
  const isCrossActor = context?.targetActor && context.targetActor !== context?.role;

  if (isCrossActor && schema.actor === context?.targetActor) {
    if (!context?.targetSheetId) {
      throw new PermissionError(
        `targetSheetId required for cross-actor access to '${schema.actor}' tables`,
        context?.role
      );
    }
    return context.targetSheetId;
  }

  if (context?.actorSheetId) {
    return context.actorSheetId;
  }

  throw new PermissionError('Actor sheet ID not provided in context', context?.role);
}
