import { BadRequestException } from '@nestjs/common';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

// Offset-based for now; cursor-based pagination will land alongside this as
// a separate params/result pair (e.g. CursorPaginationParams / CursorPage<T>)
// once the API needs stable pagination over mutating result sets.
export interface OffsetPaginationParams {
  limit: number;
  offset: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function parseOffsetPagination(query: {
  limit?: string;
  offset?: string;
}): OffsetPaginationParams {
  let limit = DEFAULT_PAGE_LIMIT;
  if (query.limit !== undefined) {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }
    limit = Math.min(limit, MAX_PAGE_LIMIT);
  }

  let offset = 0;
  if (query.offset !== undefined) {
    offset = Number(query.offset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new BadRequestException('offset must be a non-negative integer');
    }
  }

  return { limit, offset };
}
