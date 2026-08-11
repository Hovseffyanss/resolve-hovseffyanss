import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CannedResponsesController } from './canned-responses.controller';
import { CannedResponsesService } from './canned-responses.service';
import { CannedResponsesRepository } from './canned-responses.repository';
import { CannedResponse } from './canned-response.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CannedResponse])],
  controllers: [CannedResponsesController],
  providers: [CannedResponsesService, CannedResponsesRepository],
  exports: [CannedResponsesService, CannedResponsesRepository],
})
export class CannedResponsesModule {}
