"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineTable = defineTable;
const columnBuilder_1 = require("./columnBuilder");
function defineTable(input) {
    const columns = {};
    for (const [key, value] of Object.entries(input.columns)) {
        if (value instanceof columnBuilder_1.ColumnBuilder) {
            columns[key] = value.build();
        }
        else {
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
//# sourceMappingURL=defineTable.js.map