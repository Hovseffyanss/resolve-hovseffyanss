import { Controller, Get } from '@nestjs/common';
import { TicketsRepository } from '../tickets/tickets.repository';

@Controller('stats')
export class StatsController {
  constructor(private readonly tickets: TicketsRepository) {}

  @Get()
  async stats() {
    const all = await this.tickets.findAll();

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const t of all) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    }

    const resolved = all.filter((t) => t.resolvedAt !== null);
    const avgResolutionMinutes = resolved.length
      ? Math.round(
          resolved.reduce(
            (sum, t) =>
              sum +
              (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()) /
                60000,
            0,
          ) / resolved.length,
        )
      : null;

    return {
      total: all.length,
      byStatus,
      byPriority,
      avgResolutionMinutes,
    };
  }
}
