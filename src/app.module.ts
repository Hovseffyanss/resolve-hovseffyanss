import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from './audit/audit.module';
import { TicketsModule } from './tickets/tickets.module';
import { StatsModule } from './stats/stats.module';
import { HealthModule } from './health/health.module';
import { CannedResponsesModule } from './canned-responses/canned-responses.module';
import { RepliesModule } from './replies/replies.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ??
        'postgres://resolve:resolve@localhost:5432/resolve',
      autoLoadEntities: true,
      synchronize: true, // TODO: switch to migrations before any schema change

    }),
    AuditModule,
    TicketsModule,
    StatsModule,
    HealthModule,
    CannedResponsesModule,
    RepliesModule,
  ],
})
export class AppModule {}
