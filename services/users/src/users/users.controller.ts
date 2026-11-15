import { Controller, Get, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PublicUser, toPublicUser } from '../auth/auth.service';
import { PrismaService } from '../prisma.service';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    const found = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!found) {
      // 토큰은 유효하지만 사용자가 없으면 인증 실패로 취급합니다.
      throw new UnauthorizedException();
    }
    // toPublicUser 는 password/passwordHash 를 절대 포함하지 않습니다.
    return toPublicUser(found);
  }
}
