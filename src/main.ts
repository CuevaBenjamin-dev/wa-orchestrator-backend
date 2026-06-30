import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  /**
   * ValidationPipe nos ayudará más adelante a validar datos entrantes.
   *
   * whitelist: elimina campos que no estén permitidos en los DTOs.
   * transform: transforma datos entrantes al tipo esperado.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env.APP_PORT || 3000;

  await app.listen(port);

  console.log(`Backend running on http://localhost:${port}`);
}

bootstrap();
