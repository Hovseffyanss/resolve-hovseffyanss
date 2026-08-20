import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { RepliesService } from './replies.service';

@Controller('replies')
export class RepliesController {
  constructor(private readonly replies: RepliesService) {}

  // 200, not Nest's default 201: a check creates nothing (RG-1, RG-15).
  @Post('check')
  @HttpCode(HttpStatus.OK)
  check(@Body() body: { ticketId?: unknown; draft?: unknown }) {
    return this.replies.check(body ?? {});
  }
}
