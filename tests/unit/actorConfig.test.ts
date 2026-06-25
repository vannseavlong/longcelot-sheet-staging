import { resolveActorName } from '../../src/utils/actorConfig';

describe('resolveActorName()', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the string directly for shorthand string entries', () => {
    expect(resolveActorName('seller')).toBe('seller');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('prefers name over role without warning', () => {
    expect(resolveActorName({ name: 'admin', role: 'admin' })).toBe('admin');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the deprecated role field and emits a warning', () => {
    expect(resolveActorName({ role: 'seller' })).toBe('seller');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ActorConfig.role is deprecated'));
  });

  it('throws when neither name nor role is present', () => {
    expect(() => resolveActorName({})).toThrow(/requires either name or role/);
  });
});
