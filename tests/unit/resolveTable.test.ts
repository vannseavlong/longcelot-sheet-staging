import { resolveTableRef } from '../../src/cli/lib/resolveTable';
import { LoadedSchema } from '../../src/cli/lib/schemaLoader';
import { defineTable } from '../../src/schema/defineTable';
import { string } from '../../src/schema/columnBuilder';

function loaded(name: string, actor: string): LoadedSchema {
  return {
    schema: defineTable({ name, actor, columns: { title: string() } }),
    filePath: `/schemas/${actor}/${name}.ts`,
    actor,
  };
}

const all: LoadedSchema[] = [
  loaded('bookings', 'user'),
  loaded('users', 'admin'),
  loaded('profile', 'user'),
  loaded('profile', 'seller'),
];

describe('resolveTableRef()', () => {
  it('resolves a unique bare table name', () => {
    const result = resolveTableRef(all, 'bookings');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.table.actor).toBe('user');
  });

  it('flags an ambiguous bare name that exists under multiple actors', () => {
    const result = resolveTableRef(all, 'profile');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('multiple actors');
      expect(result.error).toContain('user');
      expect(result.error).toContain('seller');
    }
  });

  it('resolves an ambiguous name when disambiguated with actor/name', () => {
    const result = resolveTableRef(all, 'seller/profile');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.table.actor).toBe('seller');
  });

  it('suggests a close match for a typo', () => {
    const result = resolveTableRef(all, 'bookngs');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Did you mean 'bookings'?");
  });

  it('returns an error with no suggestion for a wildly different name', () => {
    const result = resolveTableRef(all, 'zzzzzzzzzzzzzz');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
      expect(result.error).not.toContain('Did you mean');
    }
  });

  it('returns not-found for an actor/name combination that does not exist', () => {
    const result = resolveTableRef(all, 'admin/bookings');
    expect(result.ok).toBe(false);
  });
});
