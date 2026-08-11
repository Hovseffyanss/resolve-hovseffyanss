import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketsRepository } from './tickets.repository';
import { Ticket } from './ticket.entity';
import { TicketComment } from './ticket-comment.entity';
import { TicketTag } from './ticket-tag.entity';
import { CannedResponsesModule } from '../canned-responses/canned-responses.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, TicketComment, TicketTag]),
    CannedResponsesModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService, TicketsRepository],
  exports: [TicketsService, TicketsRepository],
})
export class TicketsModule {}
