/**
 * Thrown by `createUserSheet()` when the spreadsheet was created but sharing it failed. Carries
 * `sheetId` so the caller can clean up (delete the orphaned spreadsheet) or retry the share — no
 * `users` row has been written at this point.
 */
export class SheetSharingError extends Error {
  constructor(
    public readonly sheetId: string,
    public readonly email: string,
    public readonly cause: unknown
  ) {
    super(
      `Created spreadsheet '${sheetId}' but failed to share it with '${email}': ` +
      `${cause instanceof Error ? cause.message : String(cause)}. ` +
      `No users row was written — delete or retry sharing on '${sheetId}'.`
    );
    this.name = 'SheetSharingError';
    Object.setPrototypeOf(this, SheetSharingError.prototype);
  }
}
