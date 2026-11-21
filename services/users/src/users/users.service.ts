import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { hashPassword, verifyPassword } from '../password';
import { signAccessToken } from '../auth/jwt';
import { intEnv, requireEnv } from '../config';
import {
  ChangePasswordDto,
  LoginDto,
  LoginResponse,
  SignupDto,
  UpdateProfileDto,
  UserDto,
  UserRowLike,
  toUserDto,
} from './dto';

const INVALID_CREDENTIALS = 'Invalid email or password';

interface UserRow extends UserRowLike {
  passwordHash: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

@Injectable()
export class UsersService {
  private dummyHashPromise: Promise<string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** 존재하지 않는 이메일에도 bcrypt 비교를 수행해 응답 시간 차이를 줄이기 위한 더미 해시 */
  private getDummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = hashPassword(randomBytes(24).toString('hex'));
    }
    return this.dummyHashPromise;
  }

  async signup(dto: SignupDto): Promise<UserDto> {
    const email = normalizeEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await hashPassword(dto.password);
    try {
      const created = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          role: 'USER',
          name: String(dto.name ?? '').trim(),
          phone: String(dto.phone ?? '').replace(/[\s-]/g, ''),
          marketingAgreed: dto.marketingAgreed === true,
          termsAgreedAt: new Date(),
        },
      });
      return toUserDto(created as UserRow);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Email already registered');
      }
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: unknown }).code === 'P2002'
      ) {
        throw new ConflictException('Email already registered');
      }
      throw err;
    }
  }

  async login(dto: LoginDto): Promise<LoginResponse> {
    const email = normalizeEmail(dto.email);
    const password = String(dto.password ?? '');
    const user = (await this.prisma.user.findUnique({
      where: { email },
    })) as UserRow | null;

    if (!user) {
      // 타이밍 차이를 줄이기 위해 더미 해시와 비교 후 동일한 오류를 반환
      await verifyPassword(password, await this.getDummyHash());
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const secret = requireEnv('JWT_SECRET');
    const expiresIn = intEnv('JWT_EXPIRES_IN_SECONDS', 3600);
    const role: 'USER' | 'ADMIN' = user.role === 'ADMIN' ? 'ADMIN' : 'USER';
    const accessToken = signAccessToken(
      { id: user.id, email: user.email, role },
      secret,
      expiresIn,
    );

    return {
      accessToken,
      tokenType: 'Bearer' as const,
      expiresIn,
      user: toUserDto(user),
    } as LoginResponse;
  }

  /** 가입 화면의 이메일 중복 확인. 형식 검증은 DTO 가 합니다. */
  async isEmailAvailable(rawEmail: string): Promise<{ available: boolean }> {
    const email = normalizeEmail(rawEmail);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    return { available: !existing };
  }

  private async requireUser(userId: string): Promise<UserRow> {
    if (!userId || !UUID_RE.test(userId)) {
      throw new UnauthorizedException();
    }
    const user = (await this.prisma.user.findUnique({ where: { id: userId } })) as UserRow | null;
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }

  async findMe(userId: string): Promise<UserDto> {
    return toUserDto(await this.requireUser(userId));
  }

  /** 본인 정보 수정. 이메일·역할은 여기서 바꿀 수 없습니다. */
  async updateMe(userId: string, dto: UpdateProfileDto): Promise<UserDto> {
    await this.requireUser(userId);
    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.zipcode !== undefined) data.zipcode = dto.zipcode;
    if (dto.address1 !== undefined) data.address1 = dto.address1;
    if (dto.address2 !== undefined) data.address2 = dto.address2;
    if (dto.marketingAgreed !== undefined) data.marketingAgreed = dto.marketingAgreed;
    const updated = await this.prisma.user.update({ where: { id: userId }, data });
    return toUserDto(updated as UserRow);
  }

  /** 비밀번호 변경. 현재 비밀번호가 맞아야 하고, 새 비밀번호는 현재와 달라야 합니다. */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ changed: true }> {
    const user = await this.requireUser(userId);
    const ok = await verifyPassword(String(dto.currentPassword ?? ''), user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { changed: true };
  }
}
