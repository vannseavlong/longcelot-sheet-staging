import { BooleanFormat, ColumnDefinition } from '../schema/types';
import { ColumnValidationRule } from '../adapter/sheetClient';

const BOOLEAN_FORMAT_VALUES: Record<BooleanFormat, [string, string]> = {
  TRUE_FALSE: ['TRUE', 'FALSE'],
  '1_0': ['1', '0'],
};

/**
 * Maps boolean()/enum() columns to the Sheets data validation rules formatSheet()/extendValidation()
 * apply. boolean() columns use ONE_OF_LIST (not the native BOOLEAN checkbox type) deliberately: Sheets'
 * BOOLEAN validation writes a real FALSE into every blank cell it covers, while an unselected ONE_OF_LIST
 * cell stays genuinely empty — see FAQ.md #10 for why that distinction is the actual root cause of the
 * phantom-row issue for boolean() specifically. `defaultBooleanFormat` is the project-wide sheetStyle
 * fallback; a column's own `booleanFormat` (set via `boolean({ format })`) takes priority.
 */
export function buildValidationRules(
  headers: string[],
  columns: Record<string, ColumnDefinition>,
  defaultBooleanFormat: BooleanFormat = 'TRUE_FALSE'
): ColumnValidationRule[] {
  const rules: ColumnValidationRule[] = [];
  headers.forEach((header, columnIndex) => {
    const col = columns[header];
    if (!col) return;
    if (col.type === 'boolean') {
      const values = BOOLEAN_FORMAT_VALUES[col.booleanFormat ?? defaultBooleanFormat];
      rules.push({ columnIndex, type: 'ONE_OF_LIST', values });
    } else if (col.enum && col.enum.length > 0) {
      rules.push({ columnIndex, type: 'ONE_OF_LIST', values: col.enum });
    }
  });
  return rules;
}
