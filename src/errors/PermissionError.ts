export class PermissionError extends Error {
  readonly role?: string;

  constructor(message: string, role?: string) {
    super(message);
    this.name = 'PermissionError';
    this.role = role;
    Object.setPrototypeOf(this, PermissionError.prototype);
  }
}
