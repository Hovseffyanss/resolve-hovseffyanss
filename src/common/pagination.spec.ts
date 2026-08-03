import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  parseOffsetPagination,
} from './pagination';

describe('parseOffsetPagination', () => {
  it('defaults limit and offset when neither is given', () => {
    expect(parseOffsetPagination({})).toEqual({
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
    });
  });

  it('parses valid limit and offset', () => {
    expect(parseOffsetPagination({ limit: '10', offset: '20' })).toEqual({
      limit: 10,
      offset: 20,
    });
  });

  it('clamps limit above the max down to the max', () => {
    expect(parseOffsetPagination({ limit: String(MAX_PAGE_LIMIT + 500) })).toEqual({
      limit: MAX_PAGE_LIMIT,
      offset: 0,
    });
  });

  it.each(['0', '-1', 'abc', '1.5'])(
    'rejects an invalid limit %p',
    (limit) => {
      expect(() => parseOffsetPagination({ limit })).toThrow(BadRequestException);
    },
  );

  it.each(['-1', 'abc', '1.5'])('rejects an invalid offset %p', (offset) => {
    expect(() => parseOffsetPagination({ offset })).toThrow(BadRequestException);
  });

  it('allows an explicit offset of 0', () => {
    expect(parseOffsetPagination({ offset: '0' })).toEqual({
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
    });
  });
});
