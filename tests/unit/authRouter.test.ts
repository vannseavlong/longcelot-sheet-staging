import { createAuthRouter, verifyJwt } from '../../src/auth/router';
import type { SheetAdapter } from '../../src/adapter/sheetAdapter';

function makeRes() {
  const res: { redirected?: string; statusCode?: number; body?: unknown } = {};
  return {
    redirect: (url: string) => {
      res.redirected = url;
    },
    status: (code: number) => {
      res.statusCode = code;
      return {
        json: (body: unknown) => {
          res.body = body;
        },
      };
    },
    _state: res,
  };
}

describe('createAuthRouter — OAuth state CSRF protection', () => {
  const options = {
    adapter: {} as SheetAdapter,
    jwtSecret: 'test-secret',
    frontendUrl: 'https://app.example.com',
    onUser: async () => ({ email: 'a@b.com' }),
  };

  it('embeds an unpredictable state param in the login redirect', () => {
    const router = createAuthRouter(options);
    const res = makeRes();
    router.handler({ path: '/auth/google', query: {} } as never, res as never, () => {});

    const redirected = res._state.redirected!;
    const state = new URL(redirected).searchParams.get('state');
    expect(state).toBeTruthy();
    expect(state!.split('.')).toHaveLength(3);
  });

  it('rejects a callback with no state param', async () => {
    const router = createAuthRouter(options);
    const res = makeRes();
    await router.handler({ path: '/auth/callback', query: { code: 'abc' } } as never, res as never, () => {});

    expect(res._state.statusCode).toBe(401);
    expect(res._state.body).toMatchObject({ error: expect.stringContaining('state') });
  });

  it('rejects a callback with a state signed under a different secret', async () => {
    const attackerRouter = createAuthRouter({ ...options, jwtSecret: 'attacker-secret' });
    const attackerRes = makeRes();
    attackerRouter.handler({ path: '/auth/google', query: {} } as never, attackerRes as never, () => {});
    const forgedState = new URL(attackerRes._state.redirected!).searchParams.get('state')!;

    const router = createAuthRouter(options);
    const res = makeRes();
    await router.handler(
      { path: '/auth/callback', query: { code: 'abc', state: forgedState } } as never,
      res as never,
      () => {}
    );

    expect(res._state.statusCode).toBe(401);
  });
});

describe('createAuthRouter — scopes option', () => {
  const options = {
    adapter: {} as SheetAdapter,
    jwtSecret: 'test-secret',
    frontendUrl: 'https://app.example.com',
    onUser: async () => ({ email: 'a@b.com' }),
  };

  it('defaults to the full login scope set (identity + Sheets/Drive)', () => {
    const router = createAuthRouter(options);
    const res = makeRes();
    router.handler({ path: '/auth/google', query: {} } as never, res as never, () => {});

    const scope = new URL(res._state.redirected!).searchParams.get('scope');
    expect(scope).toBe(
      'openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file'
    );
  });

  it('threads a custom scopes list through to the auth redirect', () => {
    const router = createAuthRouter({ ...options, scopes: ['openid', 'email', 'profile'] });
    const res = makeRes();
    router.handler({ path: '/auth/google', query: {} } as never, res as never, () => {});

    const scope = new URL(res._state.redirected!).searchParams.get('scope');
    expect(scope).toBe('openid email profile');
  });

  it('throws ValidationError at creation time when scopes omits openid', () => {
    expect(() => createAuthRouter({ ...options, scopes: ['email', 'profile'] })).toThrow(
      /must include 'openid'/
    );
  });
});

describe('verifyJwt', () => {
  const secret = 'test-secret';

  function signViaRouterFlow(): string {
    // signJwt isn't exported directly — exercise it the same way callback issuance does by
    // reaching into the module's own HS256 construction is out of scope here; instead build
    // a token with the same shape verifyJwt expects, mirroring signJwt's implementation.
    const crypto = require('crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const iat = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ sub: 'u1', iat, exp: iat + 3600 })).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  it('accepts a validly signed, unexpired token', () => {
    const token = signViaRouterFlow();
    const payload = verifyJwt(token, secret);
    expect(payload).toMatchObject({ sub: 'u1' });
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = signViaRouterFlow();
    expect(verifyJwt(token, 'wrong-secret')).toBeNull();
  });

  it('rejects an expired token', () => {
    const crypto = require('crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const iat = Math.floor(Date.now() / 1000) - 7200;
    const body = Buffer.from(JSON.stringify({ sub: 'u1', iat, exp: iat + 3600 })).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    const expired = `${header}.${body}.${sig}`;

    expect(verifyJwt(expired, secret)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifyJwt('not-a-jwt', secret)).toBeNull();
  });
});
