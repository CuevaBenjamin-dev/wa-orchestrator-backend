import { Injectable } from '@nestjs/common';
import { IpdeMediaSelectionError } from './ipde-media-assets.errors';
import { IpdeMediaAsset, IpdeMediaAssetType } from './ipde-media-assets.types';

@Injectable()
export class IpdeMediaSelectionService {
  selectPromotion(params: {
    assets: IpdeMediaAsset[];
    categoryCode: string | null;
  }): IpdeMediaAsset | null {
    const activePromotions = params.assets.filter(
      (asset) => asset.active && asset.type === 'PROMOTION_IMAGE',
    );
    const exact = activePromotions.filter(
      (asset) =>
        params.categoryCode !== null &&
        asset.categoryCode === params.categoryCode,
    );
    if (exact.length > 0) {
      return this.highestPriority(exact, 'PROMOTION_IMAGE');
    }
    const fallback = activePromotions.filter(
      (asset) => asset.categoryCode === 'ANY' || asset.categoryCode === 'OTROS',
    );
    return fallback.length > 0
      ? this.highestPriority(fallback, 'PROMOTION_IMAGE')
      : null;
  }

  selectPaymentMethods(assets: IpdeMediaAsset[]): IpdeMediaAsset | null {
    const candidates = assets.filter(
      (asset) => asset.active && asset.type === 'PAYMENT_METHODS_IMAGE',
    );
    return candidates.length > 0
      ? this.highestPriority(candidates, 'PAYMENT_METHODS_IMAGE')
      : null;
  }

  private highestPriority(
    assets: IpdeMediaAsset[],
    type: IpdeMediaAssetType,
  ): IpdeMediaAsset {
    const sorted = [...assets].sort(
      (left, right) => right.priority - left.priority,
    );
    const winner = sorted[0];
    const tied = sorted.filter((asset) => asset.priority === winner.priority);
    if (tied.length > 1) {
      throw new IpdeMediaSelectionError(
        type === 'PROMOTION_IMAGE'
          ? 'AMBIGUOUS_PROMOTION_MEDIA'
          : 'AMBIGUOUS_PAYMENT_METHODS_MEDIA',
      );
    }
    return winner;
  }
}
