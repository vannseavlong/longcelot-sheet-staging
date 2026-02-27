export class SchemaError extends Error {
  readonly table?: string;

  constructor(message: string, table?: string) {
    super(message);
    this.name = 'SchemaError';
    this.table = table;
    Object.setPrototypeOf(this, SchemaError.prototype);
  }
}
