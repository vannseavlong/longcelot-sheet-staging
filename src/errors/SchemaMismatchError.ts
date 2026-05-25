export class SchemaMismatchError extends Error {
  constructor(
    public readonly tableName: string,
    public readonly actorSheetId: string
  ) {
    super(
      `Schema mismatch: table '${tableName}' on sheet '${actorSheetId}' is outdated. ` +
      `Run 'sheet-db sync --all-users' or set onSchemaMismatch to 'auto-sync'.`
    );
    this.name = 'SchemaMismatchError';
  }
}
