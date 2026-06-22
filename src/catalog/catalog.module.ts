import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogService } from './catalog.service';
import { CATALOG_REPOSITORY } from './repositories/catalog.repository';
import { GeneratedCatalogRepository } from './repositories/generated-catalog.repository';
import { ManualCatalogRepository } from './repositories/manual-catalog.repository';
import { AtomicJsonFileService } from './storage/atomic-json-file.service';
import { CatalogPathsService } from './storage/catalog-paths.service';
import { PersistentStorageService } from './storage/persistent-storage.service';

@Module({
  imports: [ConfigModule],
  providers: [
    CatalogPathsService,
    PersistentStorageService,
    AtomicJsonFileService,
    ManualCatalogRepository,
    GeneratedCatalogRepository,
    CatalogService,
    {
      provide: CATALOG_REPOSITORY,
      useExisting: CatalogService,
    },
  ],
  exports: [CatalogService, CATALOG_REPOSITORY],
})
export class CatalogModule {}
