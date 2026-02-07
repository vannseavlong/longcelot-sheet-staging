import { TableSchema, ColumnDefinition } from './types';
import { ColumnBuilder } from './columnBuilder';

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
  };
}
