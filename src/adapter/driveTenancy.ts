import { SheetClient } from './sheetClient';
import { DriveFolderConfig, OAuthTokens, SheetReadCacheConfig, TokenStore } from '../schema/types';

/**
 * Shared Drive-tenancy logic used by both `SheetAdapter.createUserSheet()` (sheet placement) and
 * `DriveStorageAdapter` (file upload placement), so a file uploaded for a given actor always lands
 * in the same Drive/folder as that actor's sheet — extracted here instead of duplicated so the two
 * can never drift apart. See FAQ.md for the full per-tenant upload design.
 */

export interface DriveCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Passed from `SheetAdapter` to `DriveStorageAdapter._setClient()` at construction time — everything
 * `DriveStorageAdapter` needs to resolve the same per-actor Drive/folder `createUserSheet()` would
 * use, without `DriveStorageAdapter` needing to know about `SheetAdapterConfig` directly. Internal
 * wiring, not part of the public `createSheetAdapter()` config surface.
 */
export interface DriveTenancyInjection {
  credentials: DriveCredentials;
  cacheConfig?: SheetReadCacheConfig;
  tokenStore?: TokenStore;
  sharedDriveId?: string;
  driveFolder?: DriveFolderConfig;
}

/**
 * Resolves which `SheetClient` a per-actor Drive operation should use: explicit `actorTokens` >
 * `tokenStore.get(userId)` > the shared admin client. Mirrors `createUserSheet()`'s original
 * actor-vs-admin client choice (Phase 8.1/8.4) exactly, so sheets and file uploads for the same
 * actor land in the same Drive.
 */
export async function resolveActorClient(
  userId: string,
  adminClient: SheetClient,
  credentials: DriveCredentials,
  cacheConfig: SheetReadCacheConfig | undefined,
  tokenStore: TokenStore | undefined,
  actorTokens: OAuthTokens | undefined
): Promise<{ client: SheetClient; actorOwned: boolean }> {
  let tokens = actorTokens;
  if (!tokens && tokenStore) {
    tokens = (await tokenStore.get(userId)) ?? undefined;
  }
  if (tokens) {
    return { client: new SheetClient(credentials, tokens as unknown, cacheConfig), actorOwned: true };
  }
  return { client: adminClient, actorOwned: false };
}

/**
 * Resolves (creating if missing) the `driveFolder.root/subfolders[role]` folder on `client`, scoped
 * to `sharedDriveId` if configured. `cacheKey` lets callers namespace the cache per client/scope
 * (e.g. `admin:seller` vs `actor:user_123:seller`) so an actor-owned client's folder ID is never
 * confused with the shared admin client's folder of the same role name.
 */
export async function resolveRoleFolder(
  client: SheetClient,
  driveFolder: DriveFolderConfig | undefined,
  role: string,
  sharedDriveId: string | undefined,
  cache: Map<string, string>,
  cacheKey: string
): Promise<string | undefined> {
  if (!driveFolder) return undefined;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const rootId = await client.findOrCreateFolder(driveFolder.root, undefined, sharedDriveId);
  const subfolderName = driveFolder.subfolders?.[role] ?? role;
  const folderId = await client.findOrCreateFolder(subfolderName, rootId, sharedDriveId);

  cache.set(cacheKey, folderId);
  return folderId;
}
