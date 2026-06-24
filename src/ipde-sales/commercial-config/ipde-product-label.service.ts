import { Injectable } from '@nestjs/common';
import { ProductType } from '../../catalog/domain/catalog.types';

const PRODUCT_LABELS: Record<ProductType, string> = {
  DIPLOMADO: 'Diplomado',
  ESPECIALIZACION: 'Especialización',
  CURSO: 'Curso',
  CURSO_CAPACITACION: 'Curso de capacitación',
  CURSO_ACTUALIZACION: 'Curso de actualización',
  CURSO_ESPECIALIZACION: 'Curso de especialización',
};

@Injectable()
export class IpdeProductLabelService {
  getLabel(productType: ProductType): string {
    return PRODUCT_LABELS[productType];
  }

  getLabels(productTypes: ProductType[]): string[] {
    return productTypes.map((productType) => this.getLabel(productType));
  }
}
