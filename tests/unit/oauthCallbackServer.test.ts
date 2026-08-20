import http from 'http';
import { tryCaptureViaLoopback } from '../../src/cli/lib/oauthCallbackServer';

// Fixed high ports, one per test, to avoid clashing with anything a dev machine or CI runner
// already has bound.
const BASE_PORT = 39280;

describe('tryCaptureViaLoopback', () => {
  it('captures the code from a matching redirect and serves a success page', async () => {
    const redirectUri = `http://127.0.0.1:${BASE_PORT}/auth/callback`;
    const capture = tryCaptureViaLoopback(redirectUri);

    await waitForServer(BASE_PORT);
    const res = await fetch(`${redirectUri}?code=TEST_CODE_123&state=abc`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('lsdb authorized');
    await expect(capture).resolves.toBe('TEST_CODE_123');
  });

  it('resolves null (not the error string) when Google reports ?error=', async () => {
    const port = BASE_PORT + 1;
    const redirectUri = `http://127.0.0.1:${port}/cb`;
    const capture = tryCaptureViaLoopback(redirectUri);

    await waitForServer(port);
    const res = await fetch(`${redirectUri}?error=access_denied`);

    expect(res.status).toBe(200);
    await expect(capture).resolves.toBeNull();
  });

  it('ignores requests to unrelated paths (e.g. favicon) and keeps waiting', async () => {
    const port = BASE_PORT + 2;
    const redirectUri = `http://127.0.0.1:${port}/cb`;
    const capture = tryCaptureViaLoopback(redirectUri);

    await waitForServer(port);
    const favicon = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    expect(favicon.status).toBe(404);

    // the real redirect can still land after the stray request
    const res = await fetch(`${redirectUri}?code=STILL_WORKS`);
    expect(res.status).toBe(200);
    await expect(capture).resolves.toBe('STILL_WORKS');
  });

  it('returns null immediately for a non-loopback hostname, without binding a server', async () => {
    await expect(tryCaptureViaLoopback('https://myapp.example.com/auth/callback')).resolves.toBeNull();
  });

  it('returns null immediately for an https redirect URI', async () => {
    await expect(tryCaptureViaLoopback('https://localhost:8443/cb')).resolves.toBeNull();
  });

  it('returns null for a malformed redirect URI instead of throwing', async () => {
    await expect(tryCaptureViaLoopback('not-a-url')).resolves.toBeNull();
  });

  it('falls back to null when the port is already taken', async () => {
    const port = BASE_PORT + 3;
    const busy = http.createServer((_req, res) => res.end('busy'));
    await new Promise<void>((resolve) => busy.listen(port, '127.0.0.1', resolve));

    try {
      await expect(tryCaptureViaLoopback(`http://127.0.0.1:${port}/cb`)).resolves.toBeNull();
    } finally {
      await new Promise<void>((resolve) => busy.close(() => resolve()));
    }
  });
});

function waitForServer(port: number, attempts = 20): Promise<void> {
  return new Promise((resolve, reject) => {
    const tryConnect = (remaining: number) => {
      const socket = http
        .request({ host: '127.0.0.1', port, path: '/', method: 'HEAD' }, () => {
          socket.destroy();
          resolve();
        })
        .on('error', () => {
          if (remaining <= 0) return reject(new Error(`server on port ${port} never came up`));
          setTimeout(() => tryConnect(remaining - 1), 25);
        });
      socket.end();
    };
    tryConnect(attempts);
  });
}
