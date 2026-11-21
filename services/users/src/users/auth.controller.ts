import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CheckEmailQueryDto, LoginDto, LoginResponse, SignupDto, UserDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly usersService: UsersService) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  signup(@Body() dto: SignupDto): Promise<UserDto> {
    return this.usersService.signup(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.usersService.login(dto);
  }

  /** 가입 화면의 이메일 중복 확인: { available: true|false } */
  @Get('check-email')
  checkEmail(@Query() query: CheckEmailQueryDto): Promise<{ available: boolean }> {
    return this.usersService.isEmailAvailable(query.email);
  }
}
