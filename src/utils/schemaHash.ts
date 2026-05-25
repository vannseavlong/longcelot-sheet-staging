import { createHash } from 'crypto';
import { TableSchema } from '../schema/types';

export function computeSchemaHash(schema: TableSchema): string {
  const normalized = {
    name: schema.name,
    actor: schema.actor,
    timestamps: schema.timestamps ?? false,
    softDelete: schema.softDelete ?? false,
    columns: Object.fromEntries(
      Object.entries(schema.columns)
        .filter(([k]) => !k.startsWith('_')) // exclude auto-fields (_id, _created_at…)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, {
          type: v.type,
          required: v.required ?? false,
          unique: v.unique ?? false,
          primary: v.primary ?? false,
          enum: v.enum ?? null,
        }])
    ),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
