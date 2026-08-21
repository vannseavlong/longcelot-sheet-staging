import http from 'http';
import { URL } from 'url';
import chalk from 'chalk';

// Long enough for a human to pick an account and click through Google's consent screen,
// short enough that a genuinely abandoned `lsdb auth`/`sync` doesn't hang the terminal forever.
const CAPTURE_TIMEOUT_MS = 3 * 60 * 1000;

// Same dark/terminal-chrome/cyan-accent visual language as the project's landing page
// (sheet-db-landing's `Terminal.tsx` macOS-style window + gray-950/cyan-400→blue-500 palette),
// reimplemented here with plain inline CSS since this is a one-off page served by a local
// Node `http` server — no build step, no external stylesheet or font request.
const page = (body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>lsdb</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; padding: 1.5rem; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(to bottom, #030712, #111827, #030712);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .window {
    width: 100%; max-width: 26rem; border-radius: 0.75rem; overflow: hidden;
    background: #1e1e1e; border: 1px solid #1f2937; box-shadow: 0 25px 60px -15px rgba(0,0,0,0.6);
  }
  .titlebar { background: #323233; padding: 0.65rem 1rem; display: flex; align-items: center; gap: 0.5rem; }
  .dot { width: 0.7rem; height: 0.7rem; border-radius: 50%; }
  .dot.red { background: #ff5f56; } .dot.yellow { background: #ffbd2e; } .dot.green { background: #27c93f; }
  .titlebar span {
    margin-left: 0.4rem; color: #9ca3af; font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .body { padding: 1.75rem; }
  .prompt {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85rem;
    color: #6b7280; margin: 0 0 1.25rem;
  }
  .prompt .cmd { color: #d1d5db; }
  .status { display: flex; align-items: center; gap: 0.65rem; margin-bottom: 0.75rem; }
  .icon-badge {
    width: 2.25rem; height: 2.25rem; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .icon-badge.success { background: rgba(34, 211, 238, 0.14); }
  .icon-badge.error { background: rgba(248, 113, 113, 0.14); }
  h1 { font-size: 1.2rem; margin: 0; font-weight: 600; color: #ffffff; }
  h1.grad {
    background: linear-gradient(to right, #22d3ee, #3b82f6);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  p.msg { color: #9ca3af; font-size: 0.9rem; line-height: 1.6; margin: 0 0 1.4rem; }
  p.msg strong { color: #d1d5db; font-weight: 600; }
  .cta {
    display: inline-flex; align-items: center; gap: 0.4rem; background: #06b6d4; color: #ffffff;
    text-decoration: none; font-size: 0.85rem; font-weight: 600; padding: 0.6rem 1rem; border-radius: 0.5rem;
  }
</style></head>
<body>
  <div class="window">
    <div class="titlebar"><div class="dot red"></div><div class="dot yellow"></div><div class="dot green"></div><span>lsdb auth</span></div>
    <div class="body">${body}</div>
  </div>
</body></html>`;

const CHECK_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const X_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

const QUICK_START_URL = 'https://longcelot-sheet-db.web.app/docs/quick-start';

const SUCCESS_HTML = page(`
  <p class="prompt">$ <span class="cmd">lsdb auth</span></p>
  <div class="status"><div class="icon-badge success">${CHECK_ICON}</div><h1 class="grad">lsdb authorized</h1></div>
  <p class="msg">Your Google account is connected and the token has been saved. You can close this tab and return to your terminal.</p>
  <a class="cta" href="${QUICK_START_URL}">View Quick Start docs &rarr;</a>
`);

// `message` is a query param round-tripped through Google's redirect — untrusted input that
// lands directly in this HTML response, so it's escaped before interpolation. A local http
// server bound to localhost is still reachable from any page a browser on this machine has
// open (a top-level navigation/redirect isn't blocked by CORS), so an unescaped `?error=` here
// would be a reflected-XSS opening for as long as the loopback capture window stays alive.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const errorHtml = (message: string) =>
  page(`
    <p class="prompt">$ <span class="cmd">lsdb auth</span></p>
    <div class="status"><div class="icon-badge error">${X_ICON}</div><h1>Authorization failed</h1></div>
    <p class="msg">Google reported: <strong>${escapeHtml(message)}</strong></p>
    <p class="msg">Return to your terminal to try again.</p>
  `);

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
