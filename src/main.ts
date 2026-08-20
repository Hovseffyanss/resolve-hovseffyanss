// First import, before AppModule: app.module.ts reads process.env at import
// time. Docker Compose substitutes ${VARS} itself, so the container works
// without this — a plain `npm start` does not, and fails silently.
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`resolve listening on :${port}`);
}
bootstrap();
