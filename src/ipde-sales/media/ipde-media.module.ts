import { Module } from '@nestjs/common';
import { IpdeMediaAssetsService } from './ipde-media-assets.service';
import { IpdeMediaSelectionService } from './ipde-media-selection.service';
import { IpdeMediaStorageService } from './ipde-media-storage.service';

@Module({
  providers: [
    IpdeMediaAssetsService,
    IpdeMediaSelectionService,
    IpdeMediaStorageService,
  ],
  exports: [IpdeMediaAssetsService, IpdeMediaStorageService],
})
export class IpdeMediaModule {}
