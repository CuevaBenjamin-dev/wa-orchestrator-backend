import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { basename, dirname } from 'node:path';
import { z } from 'zod';
import { CatalogJsonValidationError } from '../domain/catalog.errors';
import { formatZodIssues } from '../domain/catalog.schemas';
import { CatalogPathsService } from './catalog-paths.service';
import { PersistentStorageService } from './persistent-storage.service';

@Injectable()
export class AtomicJsonFileService {
  private readonly logger = new Logger(AtomicJsonFileService.name);

  constructor(
    private readonly storage: PersistentStorageService,
    private readonly paths: CatalogPathsService,
  ) {}

  async write<T>(params: {
    rootDirectory: string;
    targetPath: string;
    value: T;
    schema: z.ZodType<T>;
  }): Promise<T> {
    const { rootDirectory, targetPath, value, schema } = params;
    this.paths.resolveInside(rootDirectory, targetPath);

    const validation = schema.safeParse(value);
    if (!validation.success) {
      throw new CatalogJsonValidationError(formatZodIssues(validation.error));
    }

    const parentDirectory = dirname(targetPath);
    await this.storage.ensureDirectory(parentDirectory);

    const temporaryPath = this.paths.resolveInside(
      parentDirectory,
      `.${basename(targetPath)}.tmp-${process.pid}-${randomUUID()}`,
    );
    const content = `${JSON.stringify(validation.data, null, 2)}\n`;

    try {
      await this.storage.writeUtf8Exclusive(temporaryPath, content);
      await this.storage.replaceFile(temporaryPath, targetPath);
      return validation.data;
    } catch (error) {
      await this.storage.removeFile(temporaryPath).catch((cleanupError) => {
        this.logger.error(
          `Failed to clean temporary catalog file: ${cleanupError instanceof Error ? cleanupError.name : 'UnknownError'}`,
        );
      });
      throw error;
    }
  }
}
