import { spawn } from 'child_process';

/**
 * Best-effort: opens `url` in the user's default browser. Never throws and never blocks the
 * OAuth flow — every failure mode (missing `xdg-open` in a minimal container, headless CI, an
 * unrecognized platform) is swallowed, because the caller has already printed the URL for the
 * user to open by hand as the fallback.
 */
export function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '""', url] : [url];
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      // e.g. `xdg-open` not installed — the printed URL above is the fallback.
    });
    child.unref();
  } catch {
    // never let a browser-launch failure interrupt the auth flow
  }
}
