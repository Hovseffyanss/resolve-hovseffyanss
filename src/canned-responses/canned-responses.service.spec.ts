/**
 * FROZEN TEST FILE — see specs/canned-responses-tags.md.
 * These tests assert observable behaviour only (return values, thrown
 * exceptions, exception messages). They must not be edited to make an
 * implementation pass; the implementation must be made to satisfy them.
 *
 * Assumed service surface (the implementer must match this):
 *
 *   class CannedResponsesService {
 *     create(input: { title: string; body: string }): Promise<CannedResponse>;
 *     findAll(pagination: OffsetPaginationParams): Promise<Page<CannedResponse>>;
 *   }
 *
 *   interface CannedResponse {
 *     id: string;       // newId('cr'), e.g. 'cr_a1b2c3d4'
 *     title: string;
 *     body: string;
 *     createdAt: string;
 *   }
 *
 * AC-1/AC-2/AC-3 only — AC-19 (no audit entry on creation) is covered in
 * tickets.canned-response.service.spec.ts, where AuditService is already
 * wired up.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { CannedResponsesService } from './canned-responses.service';
import { CannedResponsesRepository } from './canned-responses.repository';
import { CannedResponse } from './canned-response.entity';

describe('CannedResponsesService', () => {
  let moduleRef: TestingModule;
  let service: CannedResponsesService;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          dropSchema: true,
          synchronize: true,
          entities: [CannedResponse],
        }),
        TypeOrmModule.forFeature([CannedResponse]),
      ],
      providers: [CannedResponsesService, CannedResponsesRepository],
    }).compile();

    service = moduleRef.get(CannedResponsesService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  const valid = {
    title: 'Refund policy',
    body: 'Refunds are processed within 5 business days.',
  };

  describe('AC-1', () => {
    it('AC-1: creates a canned response and returns id, title, body, createdAt', async () => {
      const cr = await service.create(valid);
      expect(cr.id).toMatch(/^cr_/);
      expect(cr.title).toBe(valid.title);
      expect(cr.body).toBe(valid.body);
      expect(typeof cr.createdAt).toBe('string');
    });

    it('AC-1: two created canned responses get distinct ids', async () => {
      const a = await service.create(valid);
      const b = await service.create({ ...valid, title: 'Escalation notice' });
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('AC-2: validation', () => {
    it.each([
      [{ ...valid, title: undefined }, 'title must be a non-empty string'],
      [{ ...valid, title: 123 }, 'title must be a non-empty string'],
      [{ ...valid, title: '   ' }, 'title must be a non-empty string'],
      [{ ...valid, body: undefined }, 'body must be a non-empty string'],
      [{ ...valid, body: 123 }, 'body must be a non-empty string'],
      [{ ...valid, body: '   ' }, 'body must be a non-empty string'],
      [
        { ...valid, title: 'a'.repeat(201) },
        'title must be at most 200 characters',
      ],
      [
        { ...valid, body: 'a'.repeat(5001) },
        'body must be at most 5000 characters',
      ],
    ])('AC-2: rejects %p with exact message %p', async (input, message) => {
      await expect(service.create(input as any)).rejects.toThrow(
        expect.objectContaining({ message }),
      );
    });

    it('AC-2: rejects invalid input with BadRequestException', async () => {
      await expect(
        service.create({ ...valid, title: '' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('AC-2: accepts a title of exactly 200 characters after trim', async () => {
      const cr = await service.create({
        ...valid,
        title: `  ${'a'.repeat(200)}  `,
      });
      expect(cr.title).toBeDefined();
    });

    it('AC-2: accepts a body of exactly 5000 characters after trim', async () => {
      const cr = await service.create({
        ...valid,
        body: `  ${'a'.repeat(5000)}  `,
      });
      expect(cr.body).toBeDefined();
    });
  });

  describe('AC-3: listing', () => {
    it('AC-3: lists canned responses oldest-first', async () => {
      const first = await service.create({ ...valid, title: 'First' });
      const second = await service.create({ ...valid, title: 'Second' });
      const third = await service.create({ ...valid, title: 'Third' });

      const page = await service.findAll({ limit: 50, offset: 0 });
      expect(page.items.map((cr: CannedResponse) => cr.id)).toEqual([
        first.id,
        second.id,
        third.id,
      ]);
    });

    it('AC-3: returns the standard Page<T> envelope', async () => {
      await service.create(valid);
      const page = await service.findAll({ limit: 50, offset: 0 });
      expect(page).toEqual(
        expect.objectContaining({
          items: expect.any(Array),
          total: 1,
          limit: 50,
          offset: 0,
        }),
      );
    });

    it('AC-3: paginates with limit and offset', async () => {
      const created: CannedResponse[] = [];
      for (let i = 0; i < 5; i++) {
        created.push(await service.create({ ...valid, title: `CR ${i}` }));
      }
      const page = await service.findAll({ limit: 2, offset: 2 });
      expect(page.items.map((cr: CannedResponse) => cr.id)).toEqual([
        created[2].id,
        created[3].id,
      ]);
      expect(page.total).toBe(5);
      expect(page.limit).toBe(2);
      expect(page.offset).toBe(2);
    });

    it('AC-3: returns an empty page when there are no canned responses', async () => {
      const page = await service.findAll({ limit: 50, offset: 0 });
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });
  });
});
