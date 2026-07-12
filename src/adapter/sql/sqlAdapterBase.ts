import { TableSchema, UserContext, ActorPermission, FKResolver } from '../../schema/types';
import { PermissionError } from '../../errors/PermissionError';
import { SchemaError } from '../../errors/SchemaError';
import type { DatabaseAdapter } from '../types';
import { hasPermission, resolveNonAdminTenantKey, AccessControlContext } from '../accessControl';
import { SQLConnection } from './connection';
import { SQLDialect } from './dialect';
import { SQLTableOperations } from './sqlTableOperations';
import { createSQLFKResolver } from './fkResolver';
import { TenantScope } from './queryBuilder';

interface NormalisedContext extends AccessControlContext {
  userId: string;
  actor: string;
}

export interface SQLAdapterConfig {
  /** Column injected into every non-admin table to scope rows to a tenant. Default: 'tenant_id'. */
  tenantColumn?: string;
  permissions?: Record<string, ActorPermission>;
}

/**
 * Shared DatabaseAdapter implementation for the Postgres/MySQL adapters (Phase 16.2) —
 * withContext()/asActor()/table() mirror SheetAdapter's exactly (same actor/role and
 * targetActor/targetRole normalization), minus the Sheets-only schema-version-check
 * machinery, since SQL adapters never auto-sync schema at runtime (Phase 16 decision 5).
 */
export class SQLAdapterBase implements DatabaseAdapter {
  private schemas: Map<string, TableSchema> = new Map();
  private context?: NormalisedContext;
  private tenantColumn: string;
  private permissions?: Record<string, ActorPermission>;

  constructor(
    private connection: SQLConnection,
    private dialect: SQLDialect,
    config: SQLAdapterConfig = {}
  ) {
    this.tenantColumn = config.tenantColumn ?? 'tenant_id';
    this.permissions = config.permissions;
  }

  registerSchema(schema: TableSchema): void {
    this.schemas.set(schema.name, schema);
  }

  registerSchemas(schemas: TableSchema[]): void {
    schemas.forEach((schema) => this.registerSchema(schema));
  }

  withContext(context: UserContext): SQLAdapterBase {
    let actorValue: string;
    if (context.actor) {
      actorValue = context.actor;
    } else if (context.role) {
      console.warn(
        '[lsdb] UserContext.role is deprecated — use actor instead. ' +
          'See: https://github.com/longcelot/sheet-db#actors-vs-application-roles'
      );
      actorValue = context.role;
    } else {
      throw new Error('[lsdb] withContext() requires either actor or role in UserContext');
    }

    let targetActorValue: string | undefined;
    if (context.targetActor) {
      targetActorValue = context.targetActor;
    } else if (context.targetRole) {
      console.warn(
        '[lsdb] UserContext.targetRole is deprecated — use targetActor instead. ' +
          'See: https://github.com/longcelot/sheet-db#actors-vs-application-roles'
      );
      targetActorValue = context.targetRole;
    }

    const normalised: NormalisedContext = {
      userId: context.userId,
      actor: actorValue,
      role: actorValue,
      actorSheetId: context.actorSheetId,
      targetActor: targetActorValue,
      targetSheetId: context.targetSheetId,
    };

    const newAdapter = Object.create(this) as SQLAdapterBase;
    newAdapter.context = normalised;
    return newAdapter;
  }

  asActor(targetActor: string, targetSheetId: string): SQLAdapterBase {
    if (!this.context) {
      throw new PermissionError('Context required before calling asActor()', undefined);
    }
    return this.withContext({
      userId: this.context.userId,
      actor: this.context.actor,
      actorSheetId: this.context.actorSheetId,
      targetActor,
      targetSheetId,
    });
  }

  table(tableName: string): SQLTableOperations {
    const schema = this.schemas.get(tableName);
    if (!schema) {
      throw new SchemaError(`Table ${tableName} is not registered`, tableName);
    }

    if (!hasPermission(schema, this.context, this.permissions)) {
      throw new PermissionError(`User does not have permission to access ${tableName}`, this.context?.role);
    }

    const tenant: TenantScope | undefined =
      schema.actor === 'admin'
        ? undefined
        : { column: this.tenantColumn, value: resolveNonAdminTenantKey(schema, this.context) };

    const fkResolver: FKResolver = createSQLFKResolver(
      this.connection,
      this.dialect,
      this.schemas,
      this.tenantColumn,
      this.context
    );

    return new SQLTableOperations(this.connection, this.dialect, schema, tenant, fkResolver);
  }
}
