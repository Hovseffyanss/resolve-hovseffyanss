import { BadRequestException } from '@nestjs/common';

const TAG_MAX_LENGTH = 30;
const TAG_RE = /^[a-z0-9-]+$/;

// shared by addTag/removeTag/findAll's tag filter — trims, lowercases, then validates
export function normaliseAndValidateTag(input: unknown): string {
  if (typeof input !== 'string') {
    throw new BadRequestException('tag must be a non-empty string');
  }
  const tag = input.trim().toLowerCase();
  if (!tag) {
    throw new BadRequestException('tag must be a non-empty string');
  }
  if (tag.length > TAG_MAX_LENGTH || !TAG_RE.test(tag)) {
    throw new BadRequestException(
      'tag must contain only lowercase letters, digits and hyphens',
    );
  }
  return tag;
}
