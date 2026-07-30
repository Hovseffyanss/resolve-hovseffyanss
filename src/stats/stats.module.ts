import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [TicketsModule],
  controllers: [StatsController],
})
export class StatsModule {}
