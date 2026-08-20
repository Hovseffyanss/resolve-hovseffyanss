import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { RepliesController } from './replies.controller';
import { RepliesService } from './replies.service';
import { AnthropicReplyModel, REPLY_MODEL } from './reply-model';

@Module({
  imports: [TicketsModule],
  controllers: [RepliesController],
  providers: [
    RepliesService,
    // The model is the one external boundary; bound by token so tests can
    // substitute a failing or canned implementation without mocking our code.
    { provide: REPLY_MODEL, useClass: AnthropicReplyModel },
  ],
})
export class RepliesModule {}
