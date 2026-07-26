/**
 * Google Drive link formats — build/parse.
 *
 * `drive.google.com/uc?id=...` (the old `DriveStorageAdapter.upload()` default) is a download
 * endpoint, not a rendering one — it doesn't reliably load in an `<img>`/`<video>`/`<iframe>`, so
 * every downstream project ended up writing its own conversion helper. This module is that
 * conversion logic, built into the package so `adapter.upload()` returns a link that already
 * renders, and legacy download-format links can be normalised on read via `toDriveEmbedUrl()`.
 */

export type DriveMediaKind = 'image' | 'video' | 'file';

/** Classifies a MIME type into the Drive link format that renders/previews best for it. */
export function classifyDriveMediaKind(mimeType: string): DriveMediaKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

/**
 * Builds the Drive URL format that actually renders for the given media kind:
 * - `image` → the thumbnail endpoint, embeddable directly in `<img src>`
 * - `video` → Drive's built-in preview page, embeddable in an `<iframe>`
 * - `file`  → Drive's viewer page, works as a clickable open/preview link for any other file type
 */
export function buildDriveViewUrl(fileId: string, kind: DriveMediaKind): string {
  switch (kind) {
    case 'image':
      return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
    case 'video':
      return `https://drive.google.com/file/d/${fileId}/preview`;
    case 'file':
      return `https://drive.google.com/file/d/${fileId}/view`;
  }
}

/** The raw download-endpoint URL — kept for callers that need the actual bytes (e.g. server-side re-fetch), not a rendered preview. */
export function buildDriveDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?id=${fileId}`;
}

const DRIVE_ID_PATTERNS = [/[?&]id=([^&]+)/, /\/file\/d\/([^/]+)/];

/** Extracts a Drive file ID from any URL format this package produces (`uc?id=`, `thumbnail?id=`, `/file/d/{id}/...`). */
export function extractDriveFileId(url: string): string | null {
  for (const pattern of DRIVE_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Converts a Drive URL into the renderable form for the given media kind. Use this to normalise
 * links that were saved before this package returned renderable URLs by default (or saved with
 * `linkFormat: 'download'`). Unrecognised URLs are returned unchanged.
 */
export function toDriveEmbedUrl(url: string, kind: DriveMediaKind = 'image'): string {
  const fileId = extractDriveFileId(url);
  if (!fileId) return url;
  return buildDriveViewUrl(fileId, kind);
}
