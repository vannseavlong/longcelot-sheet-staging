"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SheetAdapter = void 0;
exports.createSheetAdapter = createSheetAdapter;
const sheetClient_1 = require("./sheetClient");
const crud_1 = require("./crud");
class SheetAdapter {
    constructor(config) {
        this.schemas = new Map();
        this.client = new sheetClient_1.SheetClient(config.credentials, config.tokens);
        this.adminSheetId = config.adminSheetId;
    }
    registerSchema(schema) {
        this.schemas.set(schema.name, schema);
    }
    registerSchemas(schemas) {
        schemas.forEach((schema) => this.registerSchema(schema));
    }
    withContext(context) {
        const newAdapter = Object.create(this);
        newAdapter.context = context;
        return newAdapter;
    }
    table(tableName) {
        const schema = this.schemas.get(tableName);
        if (!schema) {
            throw new Error(`Table ${tableName} is not registered`);
        }
        const spreadsheetId = this.resolveSpreadsheetId(schema);
        if (!this.hasPermission(schema)) {
            throw new Error(`User does not have permission to access ${tableName}`);
        }
        return new crud_1.CRUDOperations(this.client, spreadsheetId, schema);
    }
    async createUserSheet(userId, role, email) {
        const sheetId = await this.client.createSpreadsheet(`${role}-${userId}`);
        await this.client.shareWithUser(sheetId, process.env.SUPER_ADMIN_EMAIL, 'writer');
        await this.client.shareWithUser(sheetId, email, 'writer');
        const userTables = Array.from(this.schemas.values()).filter((s) => s.actor === role);
        for (const table of userTables) {
            await this.client.addSheet(sheetId, table.name);
            const headers = Object.keys(table.columns);
            await this.client.writeHeader(sheetId, table.name, headers);
        }
        const adminTable = this.table('users');
        await adminTable.create({
            user_id: userId,
            role,
            email,
            actor_sheet_id: sheetId,
            created_at: new Date().toISOString(),
        });
        return sheetId;
    }
    async syncSchema(schema) {
        const sheetExists = await this.sheetExists(schema);
        if (!sheetExists) {
            const spreadsheetId = this.resolveSpreadsheetId(schema);
            await this.client.addSheet(spreadsheetId, schema.name);
        }
        const headers = Object.keys(schema.columns);
        const spreadsheetId = this.resolveSpreadsheetId(schema);
        const existingSheets = await this.client.getSheetNames(spreadsheetId);
        if (existingSheets.includes(schema.name)) {
            const rows = await this.client.getAllRows(spreadsheetId, schema.name);
            if (rows.length === 0) {
                await this.client.writeHeader(spreadsheetId, schema.name, headers);
            }
        }
    }
    resolveSpreadsheetId(schema) {
        if (schema.actor === 'admin') {
            return this.adminSheetId;
        }
        if (this.context?.actorSheetId) {
            return this.context.actorSheetId;
        }
        throw new Error('Actor sheet ID not provided in context');
    }
    hasPermission(schema) {
        if (!this.context) {
            return false;
        }
        if (this.context.role === 'admin') {
            return true;
        }
        if (schema.actor === this.context.role) {
            return true;
        }
        if (schema.actor === 'admin') {
            return false;
        }
        return false;
    }
    async sheetExists(schema) {
        const spreadsheetId = this.resolveSpreadsheetId(schema);
        const sheetNames = await this.client.getSheetNames(spreadsheetId);
        return sheetNames.includes(schema.name);
    }
    getClient() {
        return this.client;
    }
}
exports.SheetAdapter = SheetAdapter;
function createSheetAdapter(config) {
    return new SheetAdapter(config);
}
//# sourceMappingURL=sheetAdapter.js.map