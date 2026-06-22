import { Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { basename } from 'node:path';
import {
  formatZodIssues,
  GeneratedSubjectCatalogEntrySchema,
  ManualCatalogFileSchema,
} from '../src/catalog/domain/catalog.schemas';
import { CatalogPathsService } from '../src/catalog/storage/catalog-paths.service';
import { PersistentStorageService } from '../src/catalog/storage/persistent-storage.service';
import { catalogFileName } from '../src/catalog/utils/catalog-file-name';
import { isFinalCatalogJsonFile } from '../src/catalog/utils/is-final-catalog-json-file';

type ValidationFailure = {
  filePath: string;
  path: string;
  message: string;
};

const logger = new Logger('IpdeCatalogValidator');

async function parseJson(
  storage: PersistentStorageService,
  filePath: string,
): Promise<{ input?: unknown; failure?: ValidationFailure }> {
  try {
    const content = await storage.readUtf8(filePath);
    return { input: JSON.parse(content) as unknown };
  } catch (error) {
    return {
      failure: {
        filePath,
        path: '<root>',
        message:
          error instanceof SyntaxError
            ? 'Invalid JSON syntax'
            : error instanceof Error
              ? `${error.name}: ${error.message}`
              : 'Unknown read error',
      },
    };
  }
}

async function validateCatalog(): Promise<number> {
  await ConfigModule.forRoot({ isGlobal: false });
  const configService = new ConfigService();
  const paths = new CatalogPathsService(configService);
  const storage = new PersistentStorageService();
  const failures: ValidationFailure[] = [];

  paths.getTenantCode();

  const manualPath = paths.getManualCatalogPath();
  const manualJson = await parseJson(storage, manualPath);
  if (manualJson.failure) {
    failures.push(manualJson.failure);
  } else {
    const result = ManualCatalogFileSchema.safeParse(manualJson.input);
    if (!result.success) {
      failures.push(
        ...formatZodIssues(result.error).map((issue) => ({
          filePath: manualPath,
          ...issue,
        })),
      );
    }
  }

  const generatedDirectory = paths.getGeneratedCatalogDir();
  let generatedFiles = 0;
  if (await storage.pathExists(generatedDirectory)) {
    const fileNames = (await storage.listFileNames(generatedDirectory)).filter(
      isFinalCatalogJsonFile,
    );
    generatedFiles = fileNames.length;

    for (const fileName of fileNames) {
      const filePath = paths.resolveInside(generatedDirectory, fileName);
      const generatedJson = await parseJson(storage, filePath);
      if (generatedJson.failure) {
        failures.push(generatedJson.failure);
        continue;
      }

      const result = GeneratedSubjectCatalogEntrySchema.safeParse(
        generatedJson.input,
      );
      if (!result.success) {
        failures.push(
          ...formatZodIssues(result.error).map((issue) => ({
            filePath,
            ...issue,
          })),
        );
        continue;
      }

      const expectedFileName = catalogFileName(result.data.normalizedName);
      if (basename(filePath) !== expectedFileName) {
        failures.push({
          filePath,
          path: 'normalizedName',
          message: `Expected file name ${expectedFileName}`,
        });
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      logger.error(
        `${failure.filePath} :: ${failure.path} :: ${failure.message}`,
      );
    }
    logger.error(`Catalog validation failed with ${failures.length} error(s)`);
    return 1;
  }

  logger.log('Manual catalog is valid');
  logger.log(`Generated catalog files validated: ${generatedFiles}`);
  return 0;
}

void validateCatalog()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    logger.error(
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : 'Unknown catalog validation error',
    );
    process.exitCode = 1;
  });
