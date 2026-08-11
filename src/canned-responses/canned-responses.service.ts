import { BadRequestException, Injectable } from '@nestjs/common';
import { CannedResponsesRepository } from './canned-responses.repository';
import { CannedResponse } from './canned-response.entity';
import { newId } from '../common/ids';
import { OffsetPaginationParams, Page } from '../common/pagination';

const TITLE_MAX = 200;
const BODY_MAX = 5000;

@Injectable()
export class CannedResponsesService {
  constructor(private readonly cannedResponses: CannedResponsesRepository) {}

  async create(input: {
    title?: string;
    body?: string;
  }): Promise<CannedResponse> {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw new BadRequestException('title must be a non-empty string');
    }
    if (typeof input.body !== 'string' || !input.body.trim()) {
      throw new BadRequestException('body must be a non-empty string');
    }
    const title = input.title.trim();
    const body = input.body.trim();
    if (title.length > TITLE_MAX) {
      throw new BadRequestException(
        `title must be at most ${TITLE_MAX} characters`,
      );
    }
    if (body.length > BODY_MAX) {
      throw new BadRequestException(
        `body must be at most ${BODY_MAX} characters`,
      );
    }

    const cannedResponse = new CannedResponse();
    cannedResponse.id = newId('cr');
    cannedResponse.title = title;
    cannedResponse.body = body;
    cannedResponse.createdAt = new Date().toISOString();

    return this.cannedResponses.save(cannedResponse);
  }

  async findAll(
    pagination: OffsetPaginationParams,
  ): Promise<Page<CannedResponse>> {
    return this.cannedResponses.findAll(pagination);
  }
}
