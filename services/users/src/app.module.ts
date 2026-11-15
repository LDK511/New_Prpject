import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { UsersController } from './users/users.controller';
import { HealthController } from './health.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@Module({
  controllers: [HealthController, AuthController, UsersController],
  providers: [PrismaService, AuthService, JwtAuthGuard],
})
export class AppModule {}
