import { Injectable } from '@nestjs/common';
import { access, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PersistentStorageUnavailableError } from '../domain/catalog.errors';

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

@Injectable()
export class PersistentStorageService {
  async pathExists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath);
      return true;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return false;
      }
      throw new PersistentStorageUnavailableError('check path', targetPath, {
        cause: error,
      });
    }
  }

  async ensureDirectory(directoryPath: string): Promise<void> {
    try {
      await mkdir(directoryPath, { recursive: true });
    } catch (error) {
      throw new PersistentStorageUnavailableError(
        'create directory',
        directoryPath,
        { cause: error },
      );
    }
  }

  async readUtf8(filePath: string): Promise<string> {
    try {
      const file = await open(filePath, 'r');
      try {
        return await file.readFile({ encoding: 'utf8' });
      } finally {
        await file.close();
      }
    } catch (error) {
      throw new PersistentStorageUnavailableError('read file', filePath, {
        cause: error,
      });
    }
  }

  async listFileNames(directoryPath: string): Promise<string[]> {
    try {
      const entries = await readdir(directoryPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    } catch (error) {
      throw new PersistentStorageUnavailableError(
        'list directory',
        directoryPath,
        { cause: error },
      );
    }
  }

  async writeUtf8Exclusive(filePath: string, content: string): Promise<void> {
    let file: Awaited<ReturnType<typeof open>> | undefined;

    try {
      file = await open(filePath, 'wx');
      await file.writeFile(content, { encoding: 'utf8' });
      await file.sync();
      await file.close();
      file = undefined;
    } catch (error) {
      if (file) {
        await file.close().catch(() => undefined);
      }
      throw new PersistentStorageUnavailableError('write file', filePath, {
        cause: error,
      });
    }
  }

  async replaceFile(sourcePath: string, targetPath: string): Promise<void> {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(errorCode(error) ?? '')) {
        throw new PersistentStorageUnavailableError(
          'replace file',
          targetPath,
          { cause: error },
        );
      }
    }

    const backupPath = `${targetPath}.backup-${randomUUID()}`;
    let backupCreated = false;

    try {
      await rename(targetPath, backupPath);
      backupCreated = true;
      await rename(sourcePath, targetPath);
      await rm(backupPath, { force: true });
    } catch (error) {
      if (backupCreated) {
        await access(targetPath).catch(async () => {
          await rename(backupPath, targetPath).catch(() => undefined);
        });
      }

      throw new PersistentStorageUnavailableError('replace file', targetPath, {
        cause: error,
      });
    }
  }

  async moveFile(sourcePath: string, targetPath: string): Promise<void> {
    await this.ensureDirectory(dirname(targetPath));
    try {
      await rename(sourcePath, targetPath);
    } catch (error) {
      throw new PersistentStorageUnavailableError('move file', sourcePath, {
        cause: error,
      });
    }
  }

  async removeFile(filePath: string): Promise<void> {
    try {
      await rm(filePath, { force: true });
    } catch (error) {
      throw new PersistentStorageUnavailableError('remove file', filePath, {
        cause: error,
      });
    }
  }
}
