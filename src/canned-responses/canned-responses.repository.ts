import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CannedResponse } from './canned-response.entity';
import { OffsetPaginationParams, Page } from '../common/pagination';

@Injectable()
export class CannedResponsesRepository {
  constructor(
    @InjectRepository(CannedResponse)
    private readonly repo: Repository<CannedResponse>,
  ) {}

  async save(cannedResponse: CannedResponse): Promise<CannedResponse> {
    return this.repo.save(cannedResponse);
  }

  async findAll(
    pagination: OffsetPaginationParams,
  ): Promise<Page<CannedResponse>> {
    const [items, total] = await this.repo.findAndCount({
      order: { seq: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return {
      items,
      total,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }

  async findById(id: string): Promise<CannedResponse | null> {
    return this.repo.findOne({ where: { id } });
  }
}
