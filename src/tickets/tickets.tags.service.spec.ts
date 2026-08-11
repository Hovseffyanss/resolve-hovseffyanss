/**
 * FROZEN TEST FILE — see specs/canned-responses-tags.md.
 * These tests assert observable behaviour only (return values, thrown
 * exceptions, exception messages, audit trail contents). They must not be
 * edited to make an implementation pass; the implementation must be made
 * to satisfy them.
 *
 * Assumed service surface (the implementer must match this):
 *
 *   class TicketsService {
 *     // ...existing members (create, changeStatus, addComment, findById,
 *     // listAudit) unchanged...
 *
 *     addTag(actor: string, ticketId: string, tag: string): Promise<Ticket>;
 *     removeTag(actor: string, ticketId: string, tag: string): Promise<Ticket>;
 *
 *     // findAll gains an optional `tag` filter, combined (AND) with the
 *     // pre-existing `status`/`priority` filters. Because Express/Nest
 *     // binds a repeated query param (`?tag=a&tag=b`) as an array rather
 *     // than a string, and this codebase's convention is "controllers
 *     // stay thin and don't validate" (services validate), `tag` here is
 *     // typed loosely enough for the service itself to reject the array
 *     // case (AC-14) rather than relying on the controller to do it.
 *     findAll(
 *       filters: { status?: string; priority?: string; tag?: string | string[] },
 *       pagination: OffsetPaginationParams,
 *     ): Promise<Page<Ticket>>;
 *   }
 *
 *   // Ticket (as returned by create/findById/findAll items) gains:
 *   //   tags: string[]   — always present, sorted alphabetically, [] if none
 *
 * addTag/removeTag both normalise the `tag` argument (trim, then
 * lowercase) before validating and storing/matching it.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketsRepository } from './tickets.repository';
import { Ticket } from './ticket.entity';
import { TicketComment } from './ticket-comment.entity';
import { TicketTag } from './ticket-tag.entity';
import { AuditService } from '../audit/audit.service';
import { AuditEntry } from '../audit/audit-entry.entity';

describe('TicketsService — tags', () => {
  let moduleRef: TestingModule;
  let service: TicketsService;
  let audit: AuditService;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          dropSchema: true,
          synchronize: true,
          entities: [Ticket, TicketComment, TicketTag, AuditEntry],
        }),
        TypeOrmModule.forFeature([Ticket, TicketComment, TicketTag, AuditEntry]),
      ],
      providers: [TicketsService, TicketsRepository, AuditService],
    }).compile();

    service = moduleRef.get(TicketsService);
    audit = moduleRef.get(AuditService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  const validTicket = {
    subject: 'Cannot log in',
    description: 'Password reset email never arrives',
    customerEmail: 'ani@example.am',
    priority: 'high',
  };

  describe('AC-7', () => {
    it('AC-7: adds a tag, normalising it (trim + lowercase) before storage', async () => {
      const t = await service.create('test', validTicket);
      const updated = await service.addTag('test', t.id, '  Bug  ');
      expect(updated.tags).toEqual(['bug']);
    });

    it('AC-7: returns the full updated ticket, not a bare tag list', async () => {
      const t = await service.create('test', validTicket);
      const updated = await service.addTag('test', t.id, 'bug');
      expect(updated.id).toBe(t.id);
      expect(updated.subject).toBe(validTicket.subject);
      expect(updated.tags).toEqual(['bug']);
    });
  });

  describe('AC-8: validation', () => {
    it('AC-8: rejects a missing tag with "tag must be a non-empty string"', async () => {
      const t = await service.create('test', validTicket);
      await expect(
        service.addTag('test', t.id, undefined as any),
      ).rejects.toThrow(
        expect.objectContaining({ message: 'tag must be a non-empty string' }),
      );
    });

    it('AC-8: rejects a non-string tag with "tag must be a non-empty string"', async () => {
      const t = await service.create('test', validTicket);
      await expect(service.addTag('test', t.id, 123 as any)).rejects.toThrow(
        expect.objectContaining({ message: 'tag must be a non-empty string' }),
      );
    });

    it('AC-8: rejects a tag containing characters outside [a-z0-9-] after normalisation', async () => {
      const t = await service.create('test', validTicket);
      await expect(service.addTag('test', t.id, 'bug fix')).rejects.toThrow(
        expect.objectContaining({
          message:
            'tag must contain only lowercase letters, digits and hyphens',
        }),
      );
    });

    it('AC-8: rejects a tag longer than 30 characters after normalisation', async () => {
      const t = await service.create('test', validTicket);
      await expect(
        service.addTag('test', t.id, 'a'.repeat(31)),
      ).rejects.toThrow(BadRequestException);
    });

    it('AC-8: accepts a tag of exactly 30 characters', async () => {
      const t = await service.create('test', validTicket);
      const tag = 'a'.repeat(30);
      const updated = await service.addTag('test', t.id, tag);
      expect(updated.tags).toEqual([tag]);
    });

    it('AC-8: accepts a single-character tag', async () => {
      const t = await service.create('test', validTicket);
      const updated = await service.addTag('test', t.id, 'a');
      expect(updated.tags).toEqual(['a']);
    });

    it('AC-8: accepts hyphens and digits', async () => {
      const t = await service.create('test', validTicket);
      const updated = await service.addTag('test', t.id, 'sev-1');
      expect(updated.tags).toEqual(['sev-1']);
    });
  });

  describe('AC-9: deduplication / no-op', () => {
    it('AC-9: adding an existing tag is a no-op — ticket unchanged, no duplicate', async () => {
      const t = await service.create('test', validTicket);
      await service.addTag('test', t.id, 'bug');
      const second = await service.addTag('test', t.id, 'bug');
      expect(second.tags).toEqual(['bug']);
    });

    it('AC-9: adding an existing tag (different casing/whitespace) writes no audit entry', async () => {
      const t = await service.create('test', validTicket);
      await service.addTag('test', t.id, 'bug');
      const before = await audit.list(t.id);
      await service.addTag('test', t.id, '  BUG  ');
      const after = await audit.list(t.id);
      expect(after.length).toBe(before.length);
    });

    it('AC-9: adding an existing tag does not advance updatedAt', async () => {
      jest.useFakeTimers({
        doNotFake: [
          'nextTick',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout',
        ],
      });
      jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      try {
        const t = await service.create('test', validTicket);
        const tagged = await service.addTag('test', t.id, 'bug');

        jest.setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
        const noop = await service.addTag('test', t.id, 'bug');

        expect(noop.updatedAt).toBe(tagged.updatedAt);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('AC-10: tag cap', () => {
    const tagAt = (i: number) => `tag-${i}`;

    it('AC-10: allows up to 10 distinct tags', async () => {
      const t = await service.create('test', validTicket);
      let updated: Ticket = t as unknown as Ticket;
      for (let i = 0; i < 10; i++) {
        updated = await service.addTag('test', t.id, tagAt(i));
      }
      expect(updated.tags).toHaveLength(10);
    });

    it('AC-10: rejects an 11th distinct tag with "ticket cannot have more than 10 tags"', async () => {
      const t = await service.create('test', validTicket);
      for (let i = 0; i < 10; i++) {
        await service.addTag('test', t.id, tagAt(i));
      }
      await expect(
        service.addTag('test', t.id, tagAt(10)),
      ).rejects.toThrow(
        expect.objectContaining({
          message: 'ticket cannot have more than 10 tags',
        }),
      );
    });

    it('AC-10: the ticket is left unchanged and no audit entry is written for a rejected 11th tag', async () => {
      const t = await service.create('test', validTicket);
      for (let i = 0; i < 10; i++) {
        await service.addTag('test', t.id, tagAt(i));
      }
      const before = await service.findById(t.id);
      const beforeAudit = await audit.list(t.id);

      await expect(
        service.addTag('test', t.id, tagAt(10)),
      ).rejects.toThrow(BadRequestException);

      const after = await service.findById(t.id);
      const afterAudit = await audit.list(t.id);
      expect(after.tags).toEqual(before.tags);
      expect(after.tags).not.toContain(tagAt(10));
      expect(afterAudit.length).toBe(beforeAudit.length);
    });

    it('AC-10: re-adding one of the existing 10 tags at the cap still succeeds as a no-op', async () => {
      const t = await service.create('test', validTicket);
      for (let i = 0; i < 10; i++) {
        await service.addTag('test', t.id, tagAt(i));
      }
      const updated = await service.addTag('test', t.id, tagAt(0));
      expect(updated.tags).toHaveLength(10);
    });
  });

  describe('AC-11: removing a tag', () => {
    it('AC-11: removes a tag and returns the full updated ticket', async () => {
      const t = await service.create('test', validTicket);
      await service.addTag('test', t.id, 'bug');
      await service.addTag('test', t.id, 'billing');

      const updated = await service.removeTag('test', t.id, 'bug');
      expect(updated.tags).toEqual(['billing']);
      expect(updated.id).toBe(t.id);
    });

    it('AC-11: normalises the path tag value the same way as AC-7 before matching', async () => {
      const t = await service.create('test', validTicket);
      await service.addTag('test', t.id, 'bug');

      const updated = await service.removeTag('test', t.id, '  BUG  ');
      expect(updated.tags).toEqual([]);
    });

    it("AC-11: 404s with \"ticket <id> does not have tag '<tag>'\" for an absent tag", async () => {
      const t = await service.create('test', validTicket);
      await expect(service.removeTag('test', t.id, 'ghost')).rejects.toThrow(
        expect.objectContaining({
          message: `ticket ${t.id} does not have tag 'ghost'`,
        }),
      );
    });

    it('AC-11: removing an absent tag throws NotFoundException', async () => {
      const t = await service.create('test', validTicket);
      await expect(service.removeTag('test', t.id, 'ghost')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('AC-12: tags are exposed, sorted alphabetically', () => {
    it('AC-12: tags are sorted alphabetically regardless of add order', async () => {
      const t = await service.create('test', validTicket);
      await service.addTag('test', t.id, 'zebra');
      await service.addTag('test', t.id, 'apple');
      const updated = await service.addTag('test', t.id, 'mango');
      expect(updated.tags).toEqual(['apple', 'mango', 'zebra']);
    });

    it('AC-12: a ticket with no tags exposes tags: [] via findById', async () => {
      const t = await service.create('test', validTicket);
      const found = await service.findById(t.id);
      expect(found.tags).toEqual([]);
    });

    it('AC-12: every item in findAll includes a sorted tags array', async () => {
      const t = await service.create('test', validTicket);
      await service.addTag('test', t.id, 'zebra');
      await service.addTag('test', t.id, 'apple');

      const page = await service.findAll({}, { limit: 50, offset: 0 });
      const found = page.items.find((i) => i.id === t.id)!;
      expect(found.tags).toEqual(['apple', 'zebra']);
    });
  });

  describe('AC-13: filtering by tag', () => {
    it('AC-13: filters tickets to those carrying the given tag', async () => {
      const a = await service.create('test', { ...validTicket, subject: 'A' });
      const b = await service.create('test', { ...validTicket, subject: 'B' });
      await service.create('test', { ...validTicket, subject: 'C' });
      await service.addTag('test', a.id, 'bug');
      await service.addTag('test', b.id, 'bug');

      const page = await service.findAll({ tag: 'bug' }, { limit: 50, offset: 0 });
      expect(page.items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
      expect(page.total).toBe(2);
    });

    it('AC-13: combines with the priority filter (AND)', async () => {
      const a = await service.create('test', { ...validTicket, subject: 'A', priority: 'high' });
      const b = await service.create('test', { ...validTicket, subject: 'B', priority: 'urgent' });
      await service.addTag('test', a.id, 'bug');
      await service.addTag('test', b.id, 'bug');

      const page = await service.findAll(
        { tag: 'bug', priority: 'high' },
        { limit: 50, offset: 0 },
      );
      expect(page.items.map((i) => i.id)).toEqual([a.id]);
      expect(page.total).toBe(1);
    });

    it('AC-13: filtering happens before pagination, so total reflects the filtered set', async () => {
      const created: Ticket[] = [];
      for (let i = 0; i < 3; i++) {
        created.push(
          await service.create('test', { ...validTicket, subject: `T${i}` }),
        );
      }
      for (const t of created) {
        await service.addTag('test', t.id, 'bug');
      }

      const page = await service.findAll(
        { tag: 'bug' },
        { limit: 2, offset: 0 },
      );
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(3);
    });
  });

  describe('AC-14: tag filter edge cases', () => {
    it('AC-14: a malformed tag filter (fails AC-8 after normalisation) is a 400', async () => {
      await expect(
        service.findAll({ tag: 'bug fix' }, { limit: 50, offset: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('AC-14: an unknown but well-formed tag filter returns an empty page, not an error', async () => {
      await service.create('test', validTicket);
      const page = await service.findAll(
        { tag: 'nonexistent-tag' },
        { limit: 50, offset: 0 },
      );
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('AC-14: a repeated tag filter (bound as an array) is a 400 "tag must be a single value"', async () => {
      await expect(
        service.findAll({ tag: ['a', 'b'] }, { limit: 50, offset: 0 }),
      ).rejects.toThrow(
        expect.objectContaining({ message: 'tag must be a single value' }),
      );
    });
  });

  describe('AC-15: ticket existence is checked before tag validation', () => {
    it('AC-15: addTag 404s for an unknown ticket even when the tag itself is invalid', async () => {
      await expect(
        service.addTag('test', 'tkt_missing', 'INVALID TAG!!'),
      ).rejects.toThrow(
        expect.objectContaining({ message: 'ticket tkt_missing not found' }),
      );
    });

    it('AC-15: addTag throws NotFoundException (not BadRequestException) for an unknown ticket', async () => {
      await expect(
        service.addTag('test', 'tkt_missing', 'INVALID TAG!!'),
      ).rejects.toThrow(NotFoundException);
    });

    it('AC-15: removeTag 404s for an unknown ticket even when the tag itself is invalid', async () => {
      await expect(
        service.removeTag('test', 'tkt_missing', 'INVALID TAG!!'),
      ).rejects.toThrow(
        expect.objectContaining({ message: 'ticket tkt_missing not found' }),
      );
    });
  });

  describe('AC-16: tagging is allowed in every status', () => {
    it('AC-16: addTag succeeds on a closed ticket and does not alter status or resolvedAt', async () => {
      const t = await service.create('test', validTicket);
      for (const to of ['open', 'in_progress', 'resolved', 'closed']) {
        await service.changeStatus('test', t.id, to);
      }
      const closed = await service.findById(t.id);

      const updated = await service.addTag('test', t.id, 'bug');
      expect(updated.status).toBe('closed');
      expect(updated.resolvedAt).toBe(closed.resolvedAt);
    });

    it('AC-16: removeTag succeeds on a closed ticket and does not alter status or resolvedAt', async () => {
      const t = await service.create('test', validTicket);
      await service.addTag('test', t.id, 'bug');
      for (const to of ['open', 'in_progress', 'resolved', 'closed']) {
        await service.changeStatus('test', t.id, to);
      }
      const closed = await service.findById(t.id);

      const updated = await service.removeTag('test', t.id, 'bug');
      expect(updated.status).toBe('closed');
      expect(updated.resolvedAt).toBe(closed.resolvedAt);
      expect(updated.tags).toEqual([]);
    });
  });

  describe('AC-17: audit trail for tag mutations', () => {
    it('AC-17: addTag writes a ticket.tagged entry with details { tag } using the resolved actor', async () => {
      const t = await service.create('test', validTicket);
      await service.addTag('agent-1', t.id, 'bug');

      const entries = await audit.list(t.id);
      const tagged = entries.find((e) => e.action === 'ticket.tagged');
      expect(tagged).toBeDefined();
      expect(tagged?.details).toEqual({ tag: 'bug' });
      expect(tagged?.actor).toBe('agent-1');
    });

    it('AC-17: removeTag writes a ticket.untagged entry with details { tag } using the resolved actor', async () => {
      const t = await service.create('test', validTicket);
      await service.addTag('test', t.id, 'bug');
      await service.removeTag('agent-2', t.id, 'bug');

      const entries = await audit.list(t.id);
      const untagged = entries.find((e) => e.action === 'ticket.untagged');
      expect(untagged).toBeDefined();
      expect(untagged?.details).toEqual({ tag: 'bug' });
      expect(untagged?.actor).toBe('agent-2');
    });
  });
});
