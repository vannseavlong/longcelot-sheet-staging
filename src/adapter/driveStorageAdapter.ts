import { StorageAdapter, UploadOptions } from '../schema/types';
import { SheetClient } from './sheetClient';
import { SchemaError } from '../errors/SchemaError';

export interface DriveStorageAdapterOptions {
  /** Default upload folder path (relative to driveFolder.root, or Drive root if unconfigured). */
  folder?: string;
}

export class DriveStorageAdapter implements StorageAdapter {
  private _client?: SheetClient;
  private readonly defaultFolder: string;
  /** Cached folder IDs: folder path -> Drive folder ID */
  private readonly _cache = new Map<string, string>();

  constructor(options?: DriveStorageAdapterOptions) {
    this.defaultFolder = options?.folder ?? 'uploads';
  }

  /** Called by SheetAdapter at construction time — injects the shared SheetClient. */
  _setClient(client: SheetClient): void {
    this._client = client;
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
    const folderPath = options.folder ?? this.defaultFolder;
    const folderId = await this.resolveFolder(folderPath);
    const fileId = await this.client.uploadFile(
      file,
      options.filename,
      options.mimeType,
      folderId,
      options.public
    );
    return `https://drive.google.com/uc?id=${fileId}`;
  }

  async delete(url: string): Promise<void> {
    const match = url.match(/[?&]id=([^&]+)/);
    if (!match) return;
    await this.client.deleteFile(match[1]);
  }

  private async resolveFolder(folderPath: string): Promise<string> {
    if (this._cache.has(folderPath)) return this._cache.get(folderPath)!;

    const segments = folderPath.split('/').filter(Boolean);
    let parentId: string | undefined;

    for (const segment of segments) {
      const cacheKey = parentId ? `${parentId}/${segment}` : segment;
      if (this._cache.has(cacheKey)) {
        parentId = this._cache.get(cacheKey)!;
      } else {
        parentId = await this.client.findOrCreateFolder(segment, parentId);
        this._cache.set(cacheKey, parentId);
      }
    }

    this._cache.set(folderPath, parentId!);
    return parentId!;
  }
}
