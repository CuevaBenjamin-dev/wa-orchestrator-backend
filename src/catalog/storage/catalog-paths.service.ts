import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  CatalogConfigurationError,
  UnsafeCatalogPathError,
} from '../domain/catalog.errors';
import { IPDE_TENANT_CODE } from '../domain/catalog.types';
import { catalogFileName } from '../utils/catalog-file-name';

@Injectable()
export class CatalogPathsService {
  constructor(private readonly configService: ConfigService) {}

  getTenantCode(): typeof IPDE_TENANT_CODE {
    const configured =
      this.optionalValue('IPDE_TENANT_CODE') ?? IPDE_TENANT_CODE;

    if (configured !== IPDE_TENANT_CODE) {
      throw new CatalogConfigurationError(
        'IPDE_TENANT_CODE',
        `expected ${IPDE_TENANT_CODE}`,
      );
    }

    return IPDE_TENANT_CODE;
  }

  getManualCatalogPath(): string {
    const configured =
      this.optionalValue('IPDE_MANUAL_CATALOG_PATH') ??
      './config/ipde/catalog.manual.json';

    return resolve(process.cwd(), configured);
  }

  getPersistentDataDir(): string {
    const configured = this.optionalValue('PERSISTENT_DATA_DIR');
    const railwayMountPath = this.optionalValue('RAILWAY_VOLUME_MOUNT_PATH');

    return resolve(
      process.cwd(),
      configured ?? railwayMountPath ?? resolve(process.cwd(), 'data'),
    );
  }

  getGeneratedCatalogDir(): string {
    const persistentDataDir = this.getPersistentDataDir();
    const subdirectory =
      this.optionalValue('IPDE_GENERATED_CATALOG_SUBDIR') ??
      'generated-catalog';

    if (isAbsolute(subdirectory)) {
      throw new CatalogConfigurationError(
        'IPDE_GENERATED_CATALOG_SUBDIR',
        'must be a relative directory',
      );
    }

    return this.resolveInside(persistentDataDir, subdirectory);
  }

  getQuarantineDir(): string {
    return this.resolveInside(this.getGeneratedCatalogDir(), 'quarantine');
  }

  getGeneratedFilePath(normalizedName: string): string {
    return this.resolveInside(
      this.getGeneratedCatalogDir(),
      catalogFileName(normalizedName),
    );
  }

  resolveInside(rootDirectory: string, ...segments: string[]): string {
    const root = resolve(rootDirectory);
    const target = resolve(root, ...segments);
    const relativePath = relative(root, target);

    if (
      relativePath === '..' ||
      relativePath.startsWith(
        `..${process.platform === 'win32' ? '\\' : '/'}`,
      ) ||
      isAbsolute(relativePath)
    ) {
      throw new UnsafeCatalogPathError(target);
    }

    return target;
  }

  private optionalValue(variableName: string): string | undefined {
    const value = this.configService.get<string>(variableName);
    if (value === undefined) {
      return undefined;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new CatalogConfigurationError(variableName, 'cannot be empty');
    }

    return trimmed;
  }
}
