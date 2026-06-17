import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService es el puente entre NestJS y PostgreSQL.
 *
 * IMPORTANTE:
 * Creamos una sola instancia de PrismaClient para evitar abrir
 * conexiones innecesarias a la base de datos.
 */
// El decorador @Injectable() marca esta clase como un proveedor que puede ser inyectado en otros componentes de NestJS. Esto permite que PrismaService sea utilizado en controladores, servicios u otros lugares donde se necesite acceso a la base de datos.
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect(); // qué significa await? -> await es una palabra clave en JavaScript que se utiliza para esperar a que una promesa se resuelva. En este caso, estamos esperando a que la conexión a la base de datos se establezca antes de continuar con la ejecución del programa. Esto asegura que PrismaClient esté listo para manejar consultas a la base de datos antes de que cualquier otro código intente usarlo.
  }

  async onModuleDestroy() {
    await this.$disconnect(); // qué significa await? -> await es una palabra clave en JavaScript que se utiliza para esperar a que una promesa se resuelva. En este caso, estamos esperando a que la desconexión de la base de datos se complete antes de finalizar el proceso. Esto asegura que todas las conexiones a la base de datos se cierren correctamente cuando el módulo se destruya, evitando posibles fugas de memoria o conexiones abiertas.
  }
}
