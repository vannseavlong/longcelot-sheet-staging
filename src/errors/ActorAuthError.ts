/**
 * Thrown when a CRUD call routed through an actor's own OAuth grant (`actorClientForCrud`) fails
 * because that grant is no longer valid (revoked, expired refresh token — Google's `invalid_grant`).
 * Re-authorize the actor and store fresh tokens, or set `actorClientForCrud.onAuthError:
 * 'fallback-admin'` to retry such calls on the admin client instead.
 */
export class ActorAuthError extends Error {
  constructor(
    public readonly userId: string,
    public readonly cause: unknown
  ) {
    super(
      `Actor '${userId}' OAuth grant is invalid (${cause instanceof Error ? cause.message : String(cause)}). ` +
      `Re-authorize this actor and update their tokens in the tokenStore.`
    );
    this.name = 'ActorAuthError';
    Object.setPrototypeOf(this, ActorAuthError.prototype);
  }
}
