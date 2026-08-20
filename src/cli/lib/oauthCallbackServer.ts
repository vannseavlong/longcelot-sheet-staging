import http from 'http';
import { URL } from 'url';
import chalk from 'chalk';

// Long enough for a human to pick an account and click through Google's consent screen,
// short enough that a genuinely abandoned `lsdb auth`/`sync` doesn't hang the terminal forever.
const CAPTURE_TIMEOUT_MS = 3 * 60 * 1000;

const page = (body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>lsdb</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b1220;
    color: #e8eefc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; padding: 2.5rem 3rem; border-radius: 12px; background: #111a2e;
    box-shadow: 0 10px 40px rgba(0,0,0,0.4); max-width: 28rem; }
  h1 { font-size: 1.3rem; margin: 0 0 0.5rem; }
  p { color: #9fb0d0; margin: 0; line-height: 1.5; }
  .icon { font-size: 2.5rem; margin-bottom: 0.5rem; }
</style></head>
<body><div class="card">${body}</div></body></html>`;

const SUCCESS_HTML = page(
  '<div class="icon">✅</div><h1>lsdb authorized</h1><p>You can close this tab and return to your terminal.</p>'
);

const errorHtml = (message: string) =>
  page(
    `<div class="icon">❌</div><h1>Authorization failed</h1><p>${message}</p><p>Return to your terminal to try again.</p>`
  );

/**
 * Best-effort automatic capture of the OAuth authorization code: spins up a temporary HTTP
 * server on the CLI's configured redirect URI and waits for Google's browser redirect to hit
 * it directly, so the user never has to copy the `code` out of the browser's address bar and
 * paste it back into the terminal by hand.
 *
 * Returns null — and never throws — whenever automatic capture isn't possible or doesn't
 * complete (non-loopback redirect URI, the port already being in use, the user closing the tab,
 * a timeout, etc). `resolveTokens()` falls back to the pre-existing manual-paste prompt in every
 * such case, so this is purely additive: nothing changes for a caller that gets null back.
 */
export async function tryCaptureViaLoopback(redirectUri: string): Promise<string | null> {
  let target: URL;
  try {
    target = new URL(redirectUri);
  } catch {
    return null;
  }

  // Only intercept redirects that land back on this machine — a public/production callback URL
  // is presumably owned by the app itself (e.g. via createAuthRouter), not something the CLI
  // should bind to.
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) return null;
  if (target.protocol !== 'http:') return null;

  const port = target.port ? Number(target.port) : 80;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      resolve(result);
    };

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? target.host}`);
      if (reqUrl.pathname !== target.pathname) {
        res.writeHead(404).end();
        return;
      }

      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(errorHtml(error));
        finish(null);
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(SUCCESS_HTML);
        finish(code);
        return;
      }

      res.writeHead(400).end();
    });

    // e.g. EADDRINUSE — commonly the app's own dev server already owns this port/path — or
    // EACCES on a privileged port. Either way, fall back rather than surface a hard error.
    server.on('error', () => finish(null));

    const timer = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);

    server.listen(port, target.hostname, () => {
      console.log(
        chalk.gray(
          `Waiting for the browser redirect on ${target.origin}${target.pathname} ` +
          `(${Math.round(CAPTURE_TIMEOUT_MS / 60000)} min timeout — falls back to a manual paste prompt)...\n`
        )
      );
    });
  });
}
