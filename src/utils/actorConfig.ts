type ActorNameSource = { name?: string; role?: string } | string;

/**
 * Resolves the actor identifier from an ActorConfig entry, preferring `name` over the
 * deprecated `role` field. Config entries may also be a bare string (shorthand actor name).
 */
export function resolveActorName(actor: ActorNameSource): string {
  if (typeof actor === 'string') {
    return actor;
  }

  if (actor.name) {
    return actor.name;
  }

  if (actor.role) {
    console.warn(
      '[lsdb] ActorConfig.role is deprecated — use name instead. ' +
      'See: https://github.com/longcelot/sheet-db#actors-vs-application-roles'
    );
    return actor.role;
  }

  throw new Error('[lsdb] ActorConfig entry requires either name or role');
}
