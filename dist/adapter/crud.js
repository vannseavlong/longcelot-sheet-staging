"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRUDOperations = void 0;
const nanoid_1 = require("nanoid");
class CRUDOperations {
    constructor(client, spreadsheetId, schema) {
        this.client = client;
        this.spreadsheetId = spreadsheetId;
        this.schema = schema;
    }
    async create(data) {
        const validated = this.validateAndApplyDefaults(data, 'create');
        validated._id = validated._id || (0, nanoid_1.nanoid)();
        if (this.schema.timestamps) {
            const now = new Date().toISOString();
            validated._created_at = now;
            validated._updated_at = now;
        }
        const headers = await this.getHeaders();
        const values = headers.map((header) => this.serializeValue(validated[header]));
        await this.client.appendRow(this.spreadsheetId, this.schema.name, values);
        return validated;
    }
    async findMany(options = {}) {
        const rows = await this.client.getAllRows(this.spreadsheetId, this.schema.name);
        if (rows.length === 0)
            return [];
        const headers = rows[0];
        const dataRows = rows.slice(1);
        let results = dataRows.map((row) => this.deserializeRow(headers, row));
        if (options.where) {
            results = results.filter((item) => this.matchesWhere(item, options.where));
        }
        if (options.orderBy) {
            const order = options.order || 'asc';
            results.sort((a, b) => {
                const aVal = a[options.orderBy];
                const bVal = b[options.orderBy];
                const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
                return order === 'asc' ? comparison : -comparison;
            });
        }
        if (options.offset) {
            results = results.slice(options.offset);
        }
        if (options.limit) {
            results = results.slice(0, options.limit);
        }
        return results;
    }
    async findOne(options = {}) {
        const results = await this.findMany({ ...options, limit: 1 });
        return results[0] || null;
    }
    async update(options) {
        const rows = await this.client.getAllRows(this.spreadsheetId, this.schema.name);
        if (rows.length === 0)
            return 0;
        const headers = rows[0];
        const dataRows = rows.slice(1);
        let updated = 0;
        for (let i = 0; i < dataRows.length; i++) {
            const item = this.deserializeRow(headers, dataRows[i]);
            if (this.matchesWhere(item, options.where)) {
                const validated = this.validateAndApplyDefaults(options.data, 'update');
                if (this.schema.timestamps) {
                    validated._updated_at = new Date().toISOString();
                }
                const merged = { ...item, ...validated };
                const values = headers.map((header) => this.serializeValue(merged[header]));
                await this.client.updateRow(this.spreadsheetId, this.schema.name, i + 2, values);
                updated++;
            }
        }
        return updated;
    }
    async delete(options) {
        if (this.schema.softDelete) {
            return await this.update({
                where: options.where,
                data: { _deleted_at: new Date().toISOString() },
            });
        }
        const rows = await this.client.getAllRows(this.spreadsheetId, this.schema.name);
        if (rows.length === 0)
            return 0;
        const headers = rows[0];
        const dataRows = rows.slice(1);
        let deleted = 0;
        for (let i = dataRows.length - 1; i >= 0; i--) {
            const item = this.deserializeRow(headers, dataRows[i]);
            if (this.matchesWhere(item, options.where)) {
                await this.client.deleteRow(this.spreadsheetId, this.schema.name, i + 2);
                deleted++;
            }
        }
        return deleted;
    }
    async getHeaders() {
        const rows = await this.client.getAllRows(this.spreadsheetId, this.schema.name);
        if (rows.length > 0) {
            return rows[0];
        }
        const headers = Object.keys(this.schema.columns);
        await this.client.writeHeader(this.spreadsheetId, this.schema.name, headers);
        return headers;
    }
    validateAndApplyDefaults(data, mode) {
        const result = { ...data };
        for (const [columnName, column] of Object.entries(this.schema.columns)) {
            const value = result[columnName];
            if (column.readonly && mode === 'update' && columnName in data) {
                throw new Error(`Column ${columnName} is readonly`);
            }
            if (value === undefined || value === null) {
                if (column.default !== undefined) {
                    result[columnName] = column.default;
                }
                else if (column.required && mode === 'create') {
                    throw new Error(`Column ${columnName} is required`);
                }
                continue;
            }
            if (column.enum && !column.enum.includes(value)) {
                throw new Error(`Column ${columnName} must be one of: ${column.enum.join(', ')}`);
            }
            if (column.min !== undefined) {
                if (typeof value === 'string' && value.length < column.min) {
                    throw new Error(`Column ${columnName} must be at least ${column.min} characters`);
                }
                if (typeof value === 'number' && value < column.min) {
                    throw new Error(`Column ${columnName} must be at least ${column.min}`);
                }
            }
            if (column.max !== undefined) {
                if (typeof value === 'string' && value.length > column.max) {
                    throw new Error(`Column ${columnName} must be at most ${column.max} characters`);
                }
                if (typeof value === 'number' && value > column.max) {
                    throw new Error(`Column ${columnName} must be at most ${column.max}`);
                }
            }
            if (column.pattern && !column.pattern.test(value)) {
                throw new Error(`Column ${columnName} does not match required pattern`);
            }
        }
        return result;
    }
    serializeValue(value) {
        if (value === null || value === undefined)
            return '';
        if (typeof value === 'boolean')
            return value ? 'TRUE' : 'FALSE';
        if (typeof value === 'object')
            return JSON.stringify(value);
        return String(value);
    }
    deserializeRow(headers, row) {
        const result = {};
        headers.forEach((header, index) => {
            const column = this.schema.columns[header];
            const value = row[index];
            if (!column) {
                result[header] = value;
                return;
            }
            if (value === '' || value === null || value === undefined) {
                result[header] = null;
                return;
            }
            switch (column.type) {
                case 'number':
                    result[header] = Number(value);
                    break;
                case 'boolean':
                    result[header] = value === 'TRUE' || value === true;
                    break;
                case 'json':
                    try {
                        result[header] = JSON.parse(value);
                    }
                    catch {
                        result[header] = value;
                    }
                    break;
                default:
                    result[header] = value;
            }
        });
        return result;
    }
    matchesWhere(item, where) {
        for (const [key, value] of Object.entries(where)) {
            if (item[key] !== value) {
                return false;
            }
        }
        return true;
    }
}
exports.CRUDOperations = CRUDOperations;
//# sourceMappingURL=crud.js.map