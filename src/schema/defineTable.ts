import { TableSchema, ColumnDefinition } from './types';
import { ColumnBuilder } from './columnBuilder';
import { SchemaError } from '../errors/SchemaError';

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

  if (input.timestamps) {
    columns._created_at = { type: 'date', readonly: true };
    columns._updated_at = { type: 'date', readonly: true };
  }

  if (input.softDelete) {
    columns._deleted_at = { type: 'date' };
  }

  columns._id = { type: 'string', required: true, unique: true, readonly: true };

  return {
    name: input.name,
    actor: input.actor,
    timestamps: input.timestamps,
    softDelete: input.softDelete,
    columns,
    pkColumn,
  };
}
