import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma.service';
import { requireEnv } from './jwt-auth.guard';

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
  createdAt: Date;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: PublicUser;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role === 'ADMIN' ? 'ADMIN' : 'USER',
    createdAt: u.createdAt,
  };
}

const BCRYPT_COST = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseExpiresIn(raw: string | undefined): string | number {
  const v = (raw ?? '').trim();
  if (!v) return '1h';
  // 단위 없는 숫자는 초로 해석합니다(jsonwebtoken 은 문자열 숫자를 ms 로 봅니다).
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

@Injectable()
export class AuthService {
  private readonly jwtSecret: string = requireEnv('JWT_SECRET');
  private readonly expiresIn: string | number = parseExpiresIn(process.env.JWT_EXPIRES_IN);
  private dummyHashPromise: Promise<string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** 존재하지 않는 사용자 로그인 시에도 같은 비용으로 비교하기 위한 더미 해시 */
  private dummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = bcrypt.hash(randomBytes(24).toString('hex'), BCRYPT_COST);
    }
    return this.dummyHashPromise;
  }

  async signup(input: { email: string; password: string; name?: string }): Promise<PublicUser> {
    const rawEmail: unknown = input?.email;
    const password: unknown = input?.password;
    const rawName: unknown = input?.name;

    if (typeof rawEmail !== 'string') throw new BadRequestException('email is required');
    const email = rawEmail.trim().toLowerCase();
    if (email.length === 0 || email.length > 254 || !EMAIL_RE.test(email)) {
      throw new BadRequestException('email is invalid');
    }
    if (typeof password !== 'string') throw new BadRequestException('password is required');
    if (password.length < 8 || password.length > 72 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new BadRequestException('password must be 8-72 characters');
    }
    let name: string | null = null;
    if (rawName !== undefined && rawName !== null) {
      if (typeof rawName !== 'string') throw new BadRequestException('name must be a string');
      const trimmed = rawName.trim();
      if (trimmed.length > 100) throw new BadRequestException('name must be at most 100 characters');
      name = trimmed.length > 0 ? trimmed : null;
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    try {
      const user = await this.prisma.user.create({
        data: { email, passwordHash, name, role: 'USER' },
      });
      return toPublicUser(user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      throw e;
    }
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const invalid = () => new UnauthorizedException('Invalid credentials');
    const pw = typeof password === 'string' ? password : '';
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';

    const user =
      normalized.length > 0 && normalized.length <= 254
        ? await this.prisma.user.findUnique({ where: { email: normalized } })
        : null;

    // 사용자 존재 여부와 상관없이 bcrypt 비교를 수행해 응답 시간 차이를 줄입니다.
    const hash = user ? user.passwordHash : await this.dummyHash();
    const pwOk = pw.length > 0 && Buffer.byteLength(pw, 'utf8') <= 72 ? await bcrypt.compare(pw, hash) : false;
    if (!pwOk) {
      await bcrypt.compare('x', hash).catch(() => false);
    }
    if (!user || !pwOk) throw invalid();

    const role: 'USER' | 'ADMIN' = user.role === 'ADMIN' ? 'ADMIN' : 'USER';
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, role },
      this.jwtSecret,
      { algorithm: 'HS256', expiresIn: this.expiresIn as jwt.SignOptions['expiresIn'] },
    );
    const decoded = jwt.decode(accessToken);
    let expiresIn = 3600;
    if (decoded && typeof decoded === 'object' && typeof decoded.exp === 'number' && typeof decoded.iat === 'number') {
      expiresIn = decoded.exp - decoded.iat;
    }

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
      user: toPublicUser(user),
    };
  }
}
