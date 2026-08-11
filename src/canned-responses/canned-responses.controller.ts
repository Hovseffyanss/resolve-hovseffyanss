import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { CannedResponsesService } from './canned-responses.service';
import { parseOffsetPagination } from '../common/pagination';

@Controller('canned-responses')
export class CannedResponsesController {
  constructor(private readonly cannedResponsesService: CannedResponsesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: Record<string, unknown>) {
    return this.cannedResponsesService.create(body as never);
  }

  @Get()
  findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const pagination = parseOffsetPagination({ limit, offset });
    return this.cannedResponsesService.findAll(pagination);
  }
}
