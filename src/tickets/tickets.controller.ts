import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketPriority, TicketStatus } from './ticket.entity';
import { parseOffsetPagination } from '../common/pagination';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(@Body() body: Record<string, unknown>, @Headers('x-actor') actor = 'api') {
    return this.ticketsService.create(actor, body as never);
  }

  @Get()
  findAll(
    @Query('status') status?: TicketStatus,
    @Query('priority') priority?: TicketPriority,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const pagination = parseOffsetPagination({ limit, offset });
    return this.ticketsService.findAll({ status, priority }, pagination);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ticketsService.findById(id);
  }

  @Post(':id/status')
  changeStatus(
    @Param('id') id: string,
    @Body() body: { to?: string },
    @Headers('x-actor') actor = 'api',
  ) {
    return this.ticketsService.changeStatus(actor, id, body?.to);
  }

  @Post(':id/comments')
  addComment(
    @Param('id') id: string,
    @Body() body: { author?: string; body?: string; internal?: boolean },
    @Headers('x-actor') actor = 'api',
  ) {
    return this.ticketsService.addComment(actor, id, body ?? {});
  }

  @Get(':id/audit')
  listAudit(@Param('id') id: string) {
    return this.ticketsService.listAudit(id);
  }
}
