import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { isSafeIpdeStorageKey } from './ipde-media-assets.schemas';
import { IpdeMediaStorageError } from './ipde-media-assets.errors';

const DEFAULT_MEDIA_STORAGE_SUBDIR = 'ipde-media';

@Injectable()
export class IpdeMediaStorageService {
  constructor(private readonly config: ConfigService) {}

  resolveStoragePath(storageKey: string): string {
    if (!isSafeIpdeStorageKey(storageKey)) {
      throw new IpdeMediaStorageError(
        'UNSAFE_MEDIA_STORAGE_KEY',
        'Unsafe IPDE media storage key',
      );
    }
    return this.resolveInside(this.getMediaStorageRoot(), storageKey);
  }

  async assertReadable(filePath: string): Promise<void> {
    try {
      await access(filePath);
    } catch {
      throw new IpdeMediaStorageError(
        'MEDIA_STORAGE_FILE_NOT_FOUND',
        'Configured IPDE media file was not found in persistent storage',
      );
    }
  }

  getMediaStorageRoot(): string {
    const persistentRoot = this.resolvePersistentRoot();
    const subdir =
      this.optionalValue('IPDE_MEDIA_STORAGE_SUBDIR') ??
      DEFAULT_MEDIA_STORAGE_SUBDIR;
    if (!isSafeIpdeStorageSubdir(subdir)) {
      throw new IpdeMediaStorageError(
        'UNSAFE_MEDIA_STORAGE_SUBDIR',
        'IPDE media storage subdirectory must be relative and safe',
      );
    }
    return this.resolveInside(persistentRoot, subdir);
  }

  private resolvePersistentRoot(): string {
    const configured = this.optionalValue('PERSISTENT_DATA_DIR');
    const railway = this.optionalValue('RAILWAY_VOLUME_MOUNT_PATH');
    return resolve(process.cwd(), configured ?? railway ?? 'data');
  }

  private resolveInside(rootDirectory: string, ...segments: string[]): string {
    const root = resolve(rootDirectory);
    const target = resolve(root, ...segments);
    const relativePath = relative(root, target);
    if (
      relativePath === '..' ||
      relativePath.startsWith('..\\') ||
      relativePath.startsWith('../') ||
      isAbsolute(relativePath)
    ) {
      throw new IpdeMediaStorageError(
        'UNSAFE_MEDIA_STORAGE_PATH',
        'Resolved IPDE media path escapes persistent storage root',
      );
    }
    return target;
  }

  private optionalValue(variableName: string): string | undefined {
    const value = this.config.get<string>(variableName);
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!trimmed) {
      throw new IpdeMediaStorageError(
        'EMPTY_MEDIA_STORAGE_CONFIG',
        `${variableName} cannot be empty`,
      );
    }
    return trimmed;
  }
}

function isSafeIpdeStorageSubdir(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 160 &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    !value.includes('..') &&
    !value.includes('//') &&
    !hasControlCharacter(value) &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
