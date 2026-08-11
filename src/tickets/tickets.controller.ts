import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketPriority, TicketStatus } from './ticket.entity';
import { parseOffsetPagination } from '../common/pagination';

function resolveActor(actorHeader?: string): string {
  return actorHeader?.trim() || 'api';
}

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
    @Query('tag') tag?: string | string[],
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const pagination = parseOffsetPagination({ limit, offset });
    return this.ticketsService.findAll({ status, priority, tag }, pagination);
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

  @Post(':id/apply-canned-response')
  @HttpCode(HttpStatus.CREATED)
  applyCannedResponse(
    @Param('id') id: string,
    @Body() body: { cannedResponseId?: string },
    @Headers('x-actor') actorHeader?: string,
  ) {
    return this.ticketsService.applyCannedResponse(
      resolveActor(actorHeader),
      id,
      body?.cannedResponseId,
    );
  }

  @Post(':id/tags')
  @HttpCode(HttpStatus.OK)
  addTag(
    @Param('id') id: string,
    @Body() body: { tag?: string },
    @Headers('x-actor') actorHeader?: string,
  ) {
    return this.ticketsService.addTag(
      resolveActor(actorHeader),
      id,
      body?.tag as never,
    );
  }

  @Delete(':id/tags/:tag')
  removeTag(
    @Param('id') id: string,
    @Param('tag') tag: string,
    @Headers('x-actor') actorHeader?: string,
  ) {
    return this.ticketsService.removeTag(resolveActor(actorHeader), id, tag);
  }

  @Get(':id/audit')
  listAudit(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const pagination = parseOffsetPagination({ limit, offset });
    return this.ticketsService.listAudit(id, pagination);
  }
}
