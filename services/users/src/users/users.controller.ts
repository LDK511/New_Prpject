import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TokenType } from '../auth/token-type.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt';
import { UsersService } from './users.service';
import { ChangePasswordDto, UpdateProfileDto, UserDto } from './dto';

/**
 * 본인 정보. 신원은 항상 검증된 access 토큰의 sub 에서만 꺼냅니다.
 * x-user-id 헤더가 토큰 sub 와 다르면 JwtAuthGuard 가 401 을 반환합니다.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
@TokenType('access')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<UserDto> {
    return this.usersService.findMe(user.userId);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<UserDto> {
    return this.usersService.updateMe(user.userId, dto);
  }

  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<{ changed: true }> {
    return this.usersService.changePassword(user.userId, dto);
  }
}
