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
 *     // findAll, listAudit) unchanged...
 *
 *     applyCannedResponse(
 *       actor: string,
 *       ticketId: string,
 *       cannedResponseId: string,
 *     ): Promise<TicketComment>;
 *   }
 *
 * `applyCannedResponse` resolves to the created comment: a public
 * (internal: false) comment whose body is a verbatim copy of the canned
 * response's body, and whose author equals the `actor` argument (AC-4 —
 * resolving an empty/absent X-Actor header down to 'api' is a controller
 * concern and is not exercised here; see the test-plan notes).
 *
 * `TicketsService` is assumed to gain a dependency capable of looking up a
 * canned response by id (e.g. an injected `CannedResponsesRepository`); the
 * test module below provides both `CannedResponsesRepository` and
 * `CannedResponsesService` so either wiring choice compiles.
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
import { CannedResponsesService } from '../canned-responses/canned-responses.service';
import { CannedResponsesRepository } from '../canned-responses/canned-responses.repository';
import { CannedResponse } from '../canned-responses/canned-response.entity';

describe('TicketsService — apply canned response', () => {
  let moduleRef: TestingModule;
  let tickets: TicketsService;
  let cannedResponses: CannedResponsesService;
  let audit: AuditService;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          dropSchema: true,
          synchronize: true,
          entities: [Ticket, TicketComment, TicketTag, AuditEntry, CannedResponse],
        }),
        TypeOrmModule.forFeature([
          Ticket,
          TicketComment,
          TicketTag,
          AuditEntry,
          CannedResponse,
        ]),
      ],
      providers: [
        TicketsService,
        TicketsRepository,
        AuditService,
        CannedResponsesService,
        CannedResponsesRepository,
      ],
    }).compile();

    tickets = moduleRef.get(TicketsService);
    cannedResponses = moduleRef.get(CannedResponsesService);
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

  const validCanned = {
    title: 'Refund policy',
    body: 'Refunds are processed within 5 business days.',
  };

  describe('AC-4', () => {
    it('AC-4: adds a public comment whose body is a verbatim copy of the canned response body', async () => {
      const t = await tickets.create('test', validTicket);
      const cr = await cannedResponses.create(validCanned);

      const comment = await tickets.applyCannedResponse('agent-1', t.id, cr.id);

      expect(comment.body).toBe(cr.body);
      expect(comment.internal).toBe(false);

      const reloaded = await tickets.findById(t.id);
      expect(reloaded.comments).toHaveLength(1);
      expect(reloaded.comments[0].body).toBe(cr.body);
      expect(reloaded.comments[0].internal).toBe(false);
    });

    it('AC-4: the comment author equals the resolved actor, matching the audit actor', async () => {
      const t = await tickets.create('test', validTicket);
      const cr = await cannedResponses.create(validCanned);

      const comment = await tickets.applyCannedResponse('agent-9', t.id, cr.id);
      expect(comment.author).toBe('agent-9');

      const entries = await audit.list(t.id);
      const applied = entries.find(
        (e) => e.action === 'ticket.canned_response_applied',
      );
      expect(applied?.actor).toBe('agent-9');
      expect(applied?.actor).toBe(comment.author);
    });
  });

  describe('AC-5', () => {
    it('AC-5: 404s when the ticket id is unknown', async () => {
      const cr = await cannedResponses.create(validCanned);
      await expect(
        tickets.applyCannedResponse('test', 'tkt_missing', cr.id),
      ).rejects.toThrow(
        expect.objectContaining({ message: 'ticket tkt_missing not found' }),
      );
    });

    it('AC-5: 404s with a NotFoundException for an unknown ticket id', async () => {
      const cr = await cannedResponses.create(validCanned);
      await expect(
        tickets.applyCannedResponse('test', 'tkt_missing', cr.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('AC-5: 404s when the canned response id is unknown', async () => {
      const t = await tickets.create('test', validTicket);
      await expect(
        tickets.applyCannedResponse('test', t.id, 'cr_missing'),
      ).rejects.toThrow(
        expect.objectContaining({
          message: 'canned response cr_missing not found',
        }),
      );
    });

    it('AC-5: 404s with a NotFoundException for an unknown canned response id', async () => {
      const t = await tickets.create('test', validTicket);
      await expect(
        tickets.applyCannedResponse('test', t.id, 'cr_missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('AC-6', () => {
    it('AC-6: rejects a missing cannedResponseId naming the field', async () => {
      const t = await tickets.create('test', validTicket);
      await expect(
        tickets.applyCannedResponse('test', t.id, undefined as any),
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('cannedResponseId'),
        }),
      );
    });

    it('AC-6: rejects a non-string cannedResponseId naming the field', async () => {
      const t = await tickets.create('test', validTicket);
      await expect(
        tickets.applyCannedResponse('test', t.id, 123 as any),
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('cannedResponseId'),
        }),
      );
    });

    it('AC-6: an empty-after-trim cannedResponseId is a 400, never a 404', async () => {
      const t = await tickets.create('test', validTicket);
      await expect(
        tickets.applyCannedResponse('test', t.id, '   '),
      ).rejects.toThrow(BadRequestException);
    });

    it('AC-6: a missing cannedResponseId throws BadRequestException, not NotFoundException', async () => {
      const t = await tickets.create('test', validTicket);
      await expect(
        tickets.applyCannedResponse('test', t.id, undefined as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('AC-17 / AC-18', () => {
    it('AC-17: writes exactly one ticket.canned_response_applied audit entry with cannedResponseId and commentId', async () => {
      const t = await tickets.create('test', validTicket);
      const cr = await cannedResponses.create(validCanned);
      const comment = await tickets.applyCannedResponse('agent-1', t.id, cr.id);

      const entries = await audit.list(t.id);
      const applied = entries.filter(
        (e) => e.action === 'ticket.canned_response_applied',
      );
      expect(applied).toHaveLength(1);
      expect(applied[0].details).toEqual({
        cannedResponseId: cr.id,
        commentId: comment.id,
      });
    });

    it('AC-18: does not write a ticket.commented entry when applying a canned response', async () => {
      const t = await tickets.create('test', validTicket);
      const cr = await cannedResponses.create(validCanned);
      await tickets.applyCannedResponse('agent-1', t.id, cr.id);

      const entries = await audit.list(t.id);
      expect(entries.some((e) => e.action === 'ticket.commented')).toBe(
        false,
      );
    });

    it('AC-18: applying a canned response writes exactly one audit entry for the mutation', async () => {
      const t = await tickets.create('test', validTicket);
      const cr = await cannedResponses.create(validCanned);

      const before = await audit.list(t.id);
      await tickets.applyCannedResponse('agent-1', t.id, cr.id);
      const after = await audit.list(t.id);

      expect(after.length).toBe(before.length + 1);
    });
  });

  describe('AC-19', () => {
    it('AC-19: creating a canned response writes no audit entry at all', async () => {
      const before = await audit.list();
      await cannedResponses.create(validCanned);
      const after = await audit.list();
      expect(after.length).toBe(before.length);
    });

    it('AC-19: no canned_response.created action ever reaches the audit trail', async () => {
      await cannedResponses.create(validCanned);
      await cannedResponses.create({ ...validCanned, title: 'Second' });

      const entries = await audit.list();
      expect(entries.map((e) => e.action)).not.toContain(
        'canned_response.created',
      );
    });
  });
});
