import { closestMatch } from '../../src/utils/suggest';

describe('closestMatch()', () => {
  it('suggests the closest candidate for a small typo', () => {
    expect(closestMatch('boookings', ['bookings', 'users', 'products'])).toBe('bookings');
  });

  it('suggests the closest candidate for a single transposition', () => {
    expect(closestMatch('pirce', ['price', 'service', 'status'])).toBe('price');
  });

  it('returns undefined when no candidate is plausibly close', () => {
    expect(closestMatch('zzzzzzzzzz', ['bookings', 'users', 'products'])).toBeUndefined();
  });

  it('returns undefined for an empty candidate list', () => {
    expect(closestMatch('anything', [])).toBeUndefined();
  });

  it('returns an exact match with zero distance', () => {
    expect(closestMatch('bookings', ['bookings', 'users'])).toBe('bookings');
  });
});
