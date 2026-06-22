import {
  IpdeOrder,
  IpdeOrderItem,
  IpdeOrderItemStatus,
  IpdeOrderStatus,
  IpdePaymentStatus,
  IpdeSubjectRequest,
  IpdeSubjectRequestStatus,
  Prisma,
} from '@prisma/client';
import {
  DuplicateIpdeOrderItemError,
  DuplicateIpdeSubjectRequestError,
  InvalidIpdeOrderAmountError,
  InvalidIpdeOrderDataError,
  IpdeOrderOwnershipError,
} from '../domain/ipde-sales.errors';
import { IpdeOrderRepository } from '../repositories/ipde-order.repository';
import { IpdeOrderService } from './ipde-order.service';

type OrderRepositoryMock = {
  [K in keyof Pick<
    IpdeOrderRepository,
    | 'getOrCreateActiveOrder'
    | 'getActiveOrder'
    | 'addSubjectRequest'
    | 'addOrRestoreOrderItem'
    | 'setItemProductType'
    | 'setItemIssuerSelection'
    | 'setCustomerFullName'
    | 'setQuote'
    | 'changeOrderStatus'
  >]: jest.MockedFunction<IpdeOrderRepository[K]>;
};

const now = new Date('2026-06-17T00:00:00.000Z');

function order(overrides: Partial<IpdeOrder> = {}): IpdeOrder {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    conversationStateId: 'state-1',
    status: IpdeOrderStatus.DRAFT,
    paymentStatus: IpdePaymentStatus.NOT_REQUESTED,
    fullName: null,
    normalizedFullName: null,
    fullNameConfirmedAt: null,
    currencyCode: 'PEN',
    quotedAmount: null,
    quoteConfirmedAt: null,
    confirmedAt: null,
    readyForIssuanceAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function subject(): IpdeSubjectRequest {
  return {
    id: 'subject-1',
    tenantId: 'tenant-1',
    orderId: 'order-1',
    categoryCode: null,
    catalogEntryId: null,
    displayName: 'Derecho Civil',
    normalizedName: 'derecho civil',
    catalogSource: null,
    status: IpdeSubjectRequestStatus.REQUESTED,
    listPresentedAt: null,
    selectionCompletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function item(overrides: Partial<IpdeOrderItem> = {}): IpdeOrderItem {
  return {
    id: 'item-1',
    tenantId: 'tenant-1',
    orderId: 'order-1',
    subjectRequestId: 'subject-1',
    catalogTopicId: null,
    topicName: 'Contratos civiles',
    normalizedTopicName: 'contratos civiles',
    productTypeCode: null,
    issuerCode: null,
    issuerVariantCode: null,
    status: IpdeOrderItemStatus.DRAFT,
    confirmedAt: null,
    removedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('IpdeOrderService', () => {
  let repository: OrderRepositoryMock;
  let service: IpdeOrderService;

  beforeEach(() => {
    repository = {
      getOrCreateActiveOrder: jest.fn(),
      getActiveOrder: jest.fn(),
      addSubjectRequest: jest.fn(),
      addOrRestoreOrderItem: jest.fn(),
      setItemProductType: jest.fn(),
      setItemIssuerSelection: jest.fn(),
      setCustomerFullName: jest.fn(),
      setQuote: jest.fn(),
      changeOrderStatus: jest.fn(),
    };
    service = new IpdeOrderService(
      repository as unknown as IpdeOrderRepository,
    );
  });

  it('returns one active order across repeated calls', async () => {
    const active = order();
    repository.getOrCreateActiveOrder.mockResolvedValue(active);
    const params = { tenantId: 'tenant-1', conversationId: 'conversation-1' };

    const first = await service.getOrCreateActiveOrder(params);
    const second = await service.getOrCreateActiveOrder(params);

    expect(first.id).toBe(second.id);
  });

  it('does not return an order owned by another tenant', async () => {
    repository.getActiveOrder.mockRejectedValue(new IpdeOrderOwnershipError());

    await expect(
      service.getActiveOrder({
        tenantId: 'tenant-2',
        conversationId: 'conversation-1',
      }),
    ).rejects.toBeInstanceOf(IpdeOrderOwnershipError);
  });

  it('adds a normalized subject request', async () => {
    repository.addSubjectRequest.mockResolvedValue(subject());

    const result = await service.addSubjectRequest({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      displayName: '  Derecho   Civil ',
      normalizedName: ' derecho civil ',
    });

    expect(result.id).toBe('subject-1');
    expect(repository.addSubjectRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Derecho Civil',
        normalizedName: 'derecho civil',
      }),
    );
  });

  it('rejects a duplicate normalized subject', async () => {
    repository.addSubjectRequest.mockRejectedValue(
      new DuplicateIpdeSubjectRequestError(),
    );

    await expect(
      service.addSubjectRequest({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        displayName: 'Derecho Civil',
        normalizedName: 'derecho civil',
      }),
    ).rejects.toBeInstanceOf(DuplicateIpdeSubjectRequestError);
  });

  it('adds a topic and rejects an active duplicate', async () => {
    repository.addOrRestoreOrderItem
      .mockResolvedValueOnce(item())
      .mockRejectedValueOnce(new DuplicateIpdeOrderItemError());
    const params = {
      tenantId: 'tenant-1',
      orderId: 'order-1',
      subjectRequestId: 'subject-1',
      topicName: 'Contratos civiles',
      normalizedTopicName: 'contratos civiles',
    };

    await expect(service.addOrRestoreOrderItem(params)).resolves.toMatchObject({
      id: 'item-1',
    });
    await expect(service.addOrRestoreOrderItem(params)).rejects.toBeInstanceOf(
      DuplicateIpdeOrderItemError,
    );
  });

  it('returns a previously removed topic as DRAFT when restored', async () => {
    repository.addOrRestoreOrderItem.mockResolvedValue(
      item({ status: IpdeOrderItemStatus.DRAFT, removedAt: null }),
    );

    const result = await service.addOrRestoreOrderItem({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      topicName: 'Contratos civiles',
      normalizedTopicName: 'contratos civiles',
    });

    expect(result.status).toBe(IpdeOrderItemStatus.DRAFT);
    expect(result.removedAt).toBeNull();
  });

  it('stores product type, issuer and issuer variant', async () => {
    repository.setItemProductType.mockResolvedValue(
      item({ productTypeCode: 'DIPLOMADO' }),
    );
    repository.setItemIssuerSelection.mockResolvedValue(
      item({ issuerCode: 'IPDE', issuerVariantCode: 'DIGITAL' }),
    );

    const product = await service.setItemProductType({
      tenantId: 'tenant-1',
      orderItemId: 'item-1',
      productTypeCode: 'DIPLOMADO',
    });
    const issuer = await service.setItemIssuerSelection({
      tenantId: 'tenant-1',
      orderItemId: 'item-1',
      issuerCode: 'IPDE',
      issuerVariantCode: 'DIGITAL',
    });

    expect(product.productTypeCode).toBe('DIPLOMADO');
    expect(issuer).toMatchObject({
      issuerCode: 'IPDE',
      issuerVariantCode: 'DIGITAL',
    });
  });

  it('normalizes only whitespace in the full name', async () => {
    repository.setCustomerFullName.mockImplementation((params) =>
      Promise.resolve(
        order({
          fullName: params.fullName,
          normalizedFullName: params.normalizedFullName,
        }),
      ),
    );

    const result = await service.setCustomerFullName({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      fullName: '  María   Ñahui Álvarez ',
      confirmed: true,
    });

    expect(result.fullName).toBe('María Ñahui Álvarez');
    expect(result.normalizedFullName).toBe('María Ñahui Álvarez');
  });

  it('rejects empty and excessively long names', () => {
    expect(() =>
      service.setCustomerFullName({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        fullName: ' ',
        confirmed: false,
      }),
    ).toThrow(InvalidIpdeOrderDataError);
    expect(() =>
      service.setCustomerFullName({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        fullName: 'a'.repeat(201),
        confirmed: false,
      }),
    ).toThrow(InvalidIpdeOrderDataError);
  });

  it('stores a non-negative Decimal quote with uppercase currency', async () => {
    repository.setQuote.mockImplementation((params) =>
      Promise.resolve(
        order({
          quotedAmount: params.amount,
          currencyCode: params.currencyCode,
        }),
      ),
    );

    const result = await service.setQuote({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      amount: new Prisma.Decimal('149.90'),
      currencyCode: 'PEN',
      confirmed: true,
    });

    expect(result.quotedAmount?.toString()).toBe('149.9');
    expect(result.currencyCode).toBe('PEN');
  });

  it('rejects negative amounts and lowercase currency codes', () => {
    expect(() =>
      service.setQuote({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        amount: new Prisma.Decimal('-1'),
        currencyCode: 'PEN',
        confirmed: false,
      }),
    ).toThrow(InvalidIpdeOrderAmountError);
    expect(() =>
      service.setQuote({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        amount: new Prisma.Decimal('1'),
        currencyCode: 'pen',
        confirmed: false,
      }),
    ).toThrow(InvalidIpdeOrderDataError);
  });
});
