import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * @Global hace que PrismaService pueda usarse en cualquier módulo
 * sin tener que importar PrismaModule una y otra vez.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
