import { Controller, Get } from '@nestjs/common';

const { name, version } = require('../../package.json');

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      service: name,
      version,
      uptime: process.uptime(),
    };
  }
}
