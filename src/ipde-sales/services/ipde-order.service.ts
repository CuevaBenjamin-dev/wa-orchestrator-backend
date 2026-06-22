import { Injectable } from '@nestjs/common';
import {
  IpdeOrder,
  IpdeOrderItem,
  IpdeOrderStatus,
  IpdeSubjectRequest,
  Prisma,
} from '@prisma/client';
import {
  InvalidIpdeOrderAmountError,
  InvalidIpdeOrderDataError,
} from '../domain/ipde-sales.errors';
import {
  AddIpdeSubjectRequestParams,
  AddOrRestoreIpdeOrderItemParams,
  ChangeIpdeOrderStatusParams,
  SetIpdeQuoteParams,
  IpdeOrderAggregate,
} from '../domain/ipde-sales.types';
import { IpdeOrderRepository } from '../repositories/ipde-order.repository';

const MAX_NAME_LENGTH = 200;
const MAX_CATALOG_TEXT_LENGTH = 160;
const MAX_CODE_LENGTH = 80;

@Injectable()
export class IpdeOrderService {
  constructor(private readonly orders: IpdeOrderRepository) {}

  getOrCreateActiveOrder(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<IpdeOrder> {
    return this.orders.getOrCreateActiveOrder(params);
  }

  getActiveOrder(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<IpdeOrder | null> {
    return this.orders.getActiveOrder(params);
  }

  getActiveOrderAggregate(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<IpdeOrderAggregate | null> {
    return this.orders.getActiveOrderAggregate(params);
  }

  addSubjectRequest(
    params: AddIpdeSubjectRequestParams,
  ): Promise<IpdeSubjectRequest> {
    return this.orders.addSubjectRequest({
      ...params,
      displayName: this.normalizeRequiredText(
        params.displayName,
        'displayName',
        MAX_CATALOG_TEXT_LENGTH,
      ),
      normalizedName: this.normalizeRequiredText(
        params.normalizedName,
        'normalizedName',
        MAX_CATALOG_TEXT_LENGTH,
      ),
      categoryCode: this.normalizeOptionalCode(
        params.categoryCode,
        'categoryCode',
      ),
      catalogEntryId: this.normalizeOptionalCode(
        params.catalogEntryId,
        'catalogEntryId',
      ),
      catalogSource: this.normalizeOptionalCode(
        params.catalogSource,
        'catalogSource',
      ),
    });
  }

  addOrRestoreOrderItem(
    params: AddOrRestoreIpdeOrderItemParams,
  ): Promise<IpdeOrderItem> {
    return this.orders.addOrRestoreOrderItem({
      ...params,
      topicName: this.normalizeRequiredText(
        params.topicName,
        'topicName',
        MAX_CATALOG_TEXT_LENGTH,
      ),
      normalizedTopicName: this.normalizeRequiredText(
        params.normalizedTopicName,
        'normalizedTopicName',
        MAX_CATALOG_TEXT_LENGTH,
      ),
      catalogTopicId: this.normalizeOptionalCode(
        params.catalogTopicId,
        'catalogTopicId',
      ),
    });
  }

  setItemProductType(params: {
    tenantId: string;
    orderItemId: string;
    productTypeCode: string;
  }): Promise<IpdeOrderItem> {
    return this.orders.setItemProductType({
      ...params,
      productTypeCode: this.normalizeRequiredText(
        params.productTypeCode,
        'productTypeCode',
        MAX_CODE_LENGTH,
      ),
    });
  }

  setItemIssuerSelection(params: {
    tenantId: string;
    orderItemId: string;
    issuerCode: string;
    issuerVariantCode: string;
  }): Promise<IpdeOrderItem> {
    return this.orders.setItemIssuerSelection({
      ...params,
      issuerCode: this.normalizeRequiredText(
        params.issuerCode,
        'issuerCode',
        MAX_CODE_LENGTH,
      ),
      issuerVariantCode: this.normalizeRequiredText(
        params.issuerVariantCode,
        'issuerVariantCode',
        MAX_CODE_LENGTH,
      ),
    });
  }

  setCustomerFullName(params: {
    tenantId: string;
    orderId: string;
    fullName: string;
    confirmed: boolean;
  }): Promise<IpdeOrder> {
    const fullName = this.normalizeRequiredText(
      params.fullName,
      'fullName',
      MAX_NAME_LENGTH,
      2,
    );
    return this.orders.setCustomerFullName({
      ...params,
      fullName,
      normalizedFullName: fullName,
    });
  }

  setQuote(params: SetIpdeQuoteParams): Promise<IpdeOrder> {
    const amount = new Prisma.Decimal(params.amount);
    if (!amount.isFinite() || amount.isNegative()) {
      throw new InvalidIpdeOrderAmountError();
    }
    if (!/^[A-Z]{3}$/.test(params.currencyCode)) {
      throw new InvalidIpdeOrderDataError('currencyCode');
    }

    return this.orders.setQuote({
      ...params,
      amount,
    });
  }

  changeOrderStatus(params: {
    tenantId: string;
    orderId: string;
    nextStatus: IpdeOrderStatus;
  }): Promise<IpdeOrder> {
    const input: ChangeIpdeOrderStatusParams = params;
    return this.orders.changeOrderStatus(input);
  }

  private normalizeRequiredText(
    value: string,
    field: string,
    maxLength: number,
    minLength = 1,
  ): string {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized.length < minLength || normalized.length > maxLength) {
      throw new InvalidIpdeOrderDataError(field);
    }
    return normalized;
  }

  private normalizeOptionalCode(
    value: string | undefined,
    field: string,
  ): string | undefined {
    return value === undefined
      ? undefined
      : this.normalizeRequiredText(value, field, MAX_CODE_LENGTH);
  }
}
