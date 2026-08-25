import { StorageAdapter, UploadOptions, UploadActorContext } from '../schema/types';
import { SheetClient } from './sheetClient';
import { SchemaError } from '../errors/SchemaError';
import { resolveActorClient, resolveRoleFolder, type DriveTenancyInjection } from './driveTenancy';
import {
  buildDriveDownloadUrl,
  buildDriveViewUrl,
  classifyDriveMediaKind,
  extractDriveFileId,
} from '../utils/driveMedia';

export interface DriveStorageAdapterOptions {
  /** Default upload folder path (relative to the resolved base folder — see UploadOptions.folder). */
  folder?: string;
}

export class DriveStorageAdapter implements StorageAdapter {
  private _client?: SheetClient;
  /** Tenancy config injected by SheetAdapter — undefined when constructed/used standalone. */
  private _tenancy?: DriveTenancyInjection;
  private readonly defaultFolder: string;
  /** Cached Drive folder IDs, keyed by a scope-namespaced path so an actor-owned client's folders
   *  never collide with the shared admin client's folders of the same name. */
  private readonly _folderCache = new Map<string, string>();
  /** Cached actor-owned SheetClients, keyed by userId — avoids rebuilding one per upload. */
  private readonly _actorClientCache = new Map<string, SheetClient>();

  constructor(options?: DriveStorageAdapterOptions) {
    this.defaultFolder = options?.folder ?? 'uploads';
  }

  /** Called by SheetAdapter at construction time — injects the shared SheetClient + tenancy config. */
  _setClient(client: SheetClient, tenancy?: DriveTenancyInjection): void {
    this._client = client;
    this._tenancy = tenancy;
  }

  private get client(): SheetClient {
    if (!this._client) {
      throw new SchemaError(
        'DriveStorageAdapter has no client. Pass it as the storage option to createSheetAdapter().'
      );
    }
    return this._client;
  }

  async upload(file: Buffer, options: UploadOptions): Promise<string> {
    const actorContext = options.actorContext;
    const { client, scopeKey } = await this.resolveClient(actorContext);

    const baseFolderId = this._tenancy && actorContext
      ? await resolveRoleFolder(
          client,
          this._tenancy.driveFolder,
          actorContext.actor,
          this._tenancy.sharedDriveId,
          this._folderCache,
          `${scopeKey}:role:${actorContext.actor}`
        )
      : undefined;

    const folderId = await this.resolveFolder(
      options.folder ?? this.defaultFolder,
      client,
      this._tenancy?.sharedDriveId,
      baseFolderId,
      scopeKey
    );

    const fileId = await client.uploadFile(
      file,
      options.filename,
      options.mimeType,
      folderId,
      options.public
    );

    if (options.linkFormat === 'download') {
      return buildDriveDownloadUrl(fileId);
    }
    return buildDriveViewUrl(fileId, classifyDriveMediaKind(options.mimeType));
  }

  async delete(url: string, actorContext?: UploadActorContext): Promise<void> {
    const fileId = extractDriveFileId(url);
    if (!fileId) return;
    const { client } = await this.resolveClient(actorContext);
    await client.deleteFile(fileId);
  }

  /**
   * Resolves which client (and folder-cache scope) an upload/delete should use for `actorContext`:
   * an actor on the actor-owned sheet model (resolved via `tokenStore`, same as `createUserSheet()`)
   * gets their own Drive; everyone else (no context, `actor: 'admin'`, or no tenancy config at all)
   * shares the single admin/default client — the pre-Phase-23 behavior.
   */
  private async resolveClient(
    actorContext?: UploadActorContext
  ): Promise<{ client: SheetClient; scopeKey: string }> {
    if (!actorContext || actorContext.actor === 'admin' || !this._tenancy) {
      return { client: this.client, scopeKey: 'admin' };
    }

    const cached = this._actorClientCache.get(actorContext.userId);
    if (cached) return { client: cached, scopeKey: `actor:${actorContext.userId}` };

    const resolved = await resolveActorClient(
      actorContext.userId,
      this.client,
      this._tenancy.credentials,
      this._tenancy.cacheConfig,
      this._tenancy.tokenStore,
      undefined
    );

    if (!resolved.actorOwned) {
      return { client: this.client, scopeKey: 'admin' };
    }

    this._actorClientCache.set(actorContext.userId, resolved.client);
    return { client: resolved.client, scopeKey: `actor:${actorContext.userId}` };
  }

  private async resolveFolder(
    folderPath: string,
    client: SheetClient,
    sharedDriveId: string | undefined,
    baseFolderId: string | undefined,
    scopeKey: string
  ): Promise<string | undefined> {
    const segments = folderPath.split('/').filter(Boolean);
    if (segments.length === 0) return baseFolderId;

    let parentId = baseFolderId;
    let cacheKey = `${scopeKey}:${baseFolderId ?? 'root'}`;

    for (const segment of segments) {
      cacheKey = `${cacheKey}/${segment}`;
      if (this._folderCache.has(cacheKey)) {
        parentId = this._folderCache.get(cacheKey)!;
      } else {
        parentId = await client.findOrCreateFolder(segment, parentId, sharedDriveId);
        this._folderCache.set(cacheKey, parentId);
      }
    }

    return parentId;
  }
}
