import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { UsersService } from './users.service';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
