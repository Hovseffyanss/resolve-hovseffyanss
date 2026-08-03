import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

const pkg = require('../../package.json');

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('returns the service name and version from package.json', () => {
    const result = controller.health();
    expect(result.service).toBe(pkg.name);
    expect(result.version).toBe(pkg.version);
  });

  it('returns a non-negative uptime in seconds', () => {
    const result = controller.health();
    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });
});
