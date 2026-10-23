import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthzController } from './authz.controller.js';
import { AuthzService } from './authz.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthzController],
  providers: [AuthzService],
  exports: [AuthzService],
})
export class AuthzModule {}
