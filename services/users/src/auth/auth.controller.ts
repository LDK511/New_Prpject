import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService, LoginResponse, PublicUser } from './auth.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;
const MAX_NAME_LENGTH = 100;

function asRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('email is required');
  }
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    throw new BadRequestException('email is invalid');
  }
  return email;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() rawBody: unknown): Promise<PublicUser> {
    const body = asRecord(rawBody);
    const email = normalizeEmail(body.email);

    const password = body.password;
    if (typeof password !== 'string') {
      throw new BadRequestException('password is required');
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
      );
    }

    let name: string | undefined;
    if (body.name !== undefined && body.name !== null) {
      if (typeof body.name !== 'string') {
        throw new BadRequestException('name must be a string');
      }
      const trimmed = body.name.trim();
      if (trimmed.length > MAX_NAME_LENGTH) {
        throw new BadRequestException(`name must be at most ${MAX_NAME_LENGTH} characters`);
      }
      name = trimmed.length > 0 ? trimmed : undefined;
    }

    return this.authService.signup({ email, password, name });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() rawBody: unknown): Promise<LoginResponse> {
    const body = asRecord(rawBody);
    const email = body.email;
    const password = body.password;
    if (typeof email !== 'string' || typeof password !== 'string' || email.trim().length === 0 || password.length === 0) {
      throw new BadRequestException('email and password are required');
    }
    // 길이 상한만 막고(과도한 입력 방지), 그 밖의 실패는 서비스가 일반화된 401로 응답합니다.
    if (email.length > MAX_EMAIL_LENGTH || password.length > 1024) {
      throw new BadRequestException('email or password is too long');
    }
    return this.authService.login(email.trim().toLowerCase(), password);
  }
}
