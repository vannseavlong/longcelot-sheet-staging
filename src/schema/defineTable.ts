import { TableSchema, ColumnDefinition } from './types';
import { ColumnBuilder } from './columnBuilder';
import { SchemaError } from '../errors/SchemaError';
import { RESERVED_COLUMN_NAMES } from './reservedColumns';

interface TableInput {
  name: string;
  actor: string;
  timestamps?: boolean;
  softDelete?: boolean;
  columns: Record<string, ColumnBuilder | ColumnDefinition>;
}

export function defineTable(input: TableInput): TableSchema {
  const columns: Record<string, ColumnDefinition> = {};

  for (const [key, value] of Object.entries(input.columns)) {
    if (value instanceof ColumnBuilder) {
      columns[key] = value.build();
    } else {
      columns[key] = value;
    }
  }

  const primaryColumns = Object.entries(columns).filter(([, col]) => col.primary);
  if (primaryColumns.length > 1) {
    const names = primaryColumns.map(([k]) => k).join(', ');
    throw new SchemaError(
      `Table '${input.name}' has ${primaryColumns.length} primary columns (${names}). Only one primary() column is allowed.`,
      input.name
    );
  }

  const pkColumn = primaryColumns.length === 1 ? primaryColumns[0][0] : undefined;

  const [ID, CREATED_AT, UPDATED_AT, DELETED_AT] = RESERVED_COLUMN_NAMES;

  if (input.timestamps) {
    columns[CREATED_AT] = { type: 'date', readonly: true };
    columns[UPDATED_AT] = { type: 'date', readonly: true };
  }

  if (input.softDelete) {
    columns[DELETED_AT] = { type: 'date' };
  }

  columns[ID] = { type: 'string', required: true, unique: true, readonly: true };

  return {
    name: input.name,
    actor: input.actor,
    timestamps: input.timestamps,
    softDelete: input.softDelete,
    columns,
    pkColumn,
  };
}
