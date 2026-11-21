import { randomBytes } from 'crypto';

// 테스트용 환경 변수는 서비스 모듈을 불러오기 전에 설정합니다.
// 비밀값은 코드에 두지 않고, 환경 변수가 없으면 실행 시점에 무작위로 만듭니다.
process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
process.env.BCRYPT_ROUNDS = '4';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';

import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma.service';
import { hashPassword } from '../password';
import { UsersService } from './users.service';

const SECRET = process.env.JWT_SECRET as string;
// 테스트 비밀번호도 실행 시점에 무작위로 만듭니다.
const SIGNUP_PW = randomBytes(12).toString('hex');
const CORRECT_PW = randomBytes(12).toString('hex');
const WRONG_PW = randomBytes(12).toString('hex');
const OTHER_PW = randomBytes(12).toString('hex');
const SIGNUP_BASE = { email: 'alice@example.com', name: '앨리스', phone: '01012345678', agreeTerms: true, agreePrivacy: true };

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

function makeUser(passwordHash: string): StoredUser {
  const now = new Date('2024-01-01T00:00:00.000Z');
  return {
    id: '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b',
    email: 'alice@example.com',
    passwordHash,
    role: 'USER',
    createdAt: now,
    updatedAt: now,
  };
}

describe('UsersService', () => {
  let service: UsersService;
  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('중복 이메일로 가입하면 ConflictException(409)을 던진다', async () => {
    const existing = makeUser(await hashPassword(SIGNUP_PW));
    prismaMock.user.findUnique.mockResolvedValue(existing);
    prismaMock.user.findFirst.mockResolvedValue(existing);
    prismaMock.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.signup({ ...SIGNUP_BASE, password: SIGNUP_PW }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('가입 시 비밀번호는 평문이 아닌 해시로 저장된다', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(
      async (args: { data: { email: string; passwordHash: string; role?: string } }) => ({
        ...makeUser(args.data.passwordHash),
        email: args.data.email,
      }),
    );

    const result = await service.signup({ ...SIGNUP_BASE, password: SIGNUP_PW });
    expect(result.email).toBe('alice@example.com');
    expect(result).not.toHaveProperty('passwordHash');

    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.user.create.mock.calls[0][0] as {
      data: { passwordHash: string };
    };
    expect(createArgs.data.passwordHash).toBeDefined();
    expect(createArgs.data.passwordHash).not.toBe(SIGNUP_PW);
  });

  it('틀린 비밀번호로 로그인하면 UnauthorizedException(401)을 던진다', async () => {
    const user = makeUser(await hashPassword(CORRECT_PW));
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.user.findFirst.mockResolvedValue(user);

    await expect(
      service.login({ email: 'alice@example.com', password: WRONG_PW }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('없는 이메일로 로그인해도 같은 UnauthorizedException(401)을 던진다', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.findFirst.mockResolvedValue(null);

    await expect(
      service.login({ email: 'nobody@example.com', password: OTHER_PW }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('올바른 비밀번호로 로그인하면 검증 가능한 access 토큰을 발급한다', async () => {
    const user = makeUser(await hashPassword(CORRECT_PW));
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.user.findFirst.mockResolvedValue(user);

    const res = await service.login({ email: 'alice@example.com', password: CORRECT_PW });
    expect(res.tokenType).toBe('Bearer');
    expect(typeof res.expiresIn).toBe('number');
    expect(typeof res.accessToken).toBe('string');
    expect(res.user.id).toBe(user.id);
    expect(res.user).not.toHaveProperty('passwordHash');

    const payload = jwt.verify(res.accessToken, SECRET, {
      algorithms: ['HS256'],
      issuer: 'shop-users',
      audience: 'shop-api',
    }) as jwt.JwtPayload;
    expect(payload.sub).toBe(user.id);
    expect(payload.role).toBe('USER');
    expect(payload.typ).toBe('access');
  });

  it('가입 시 이름·연락처·약관 동의 시각을 저장한다', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...makeUser('hash'),
      ...args.data,
    }));
    const result = await service.signup({ ...SIGNUP_BASE, phone: '010-1234-5678', password: SIGNUP_PW, marketingAgreed: true });
    const data = prismaMock.user.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.name).toBe('앨리스');
    expect(data.phone).toBe('01012345678');
    expect(data.termsAgreedAt).toBeInstanceOf(Date);
    expect(result.name).toBe('앨리스');
    expect(result.marketingAgreed).toBe(true);
  });

  it('이메일 중복 확인은 가입 여부만 알려준다', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    expect(await service.isEmailAvailable(' New@Example.com ')).toEqual({ available: true });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'new@example.com' } });
    prismaMock.user.findUnique.mockResolvedValueOnce(makeUser('hash'));
    expect(await service.isEmailAvailable('alice@example.com')).toEqual({ available: false });
  });

  it('본인 정보 수정은 보낸 항목만 바꾸고 이메일·역할은 건드리지 않는다', async () => {
    const user = makeUser('hash');
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.user.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...user, ...args.data }));
    const result = await service.updateMe(user.id, { name: '새이름', zipcode: '04524', address1: '서울 중구 세종대로 110' });
    const args = prismaMock.user.update.mock.calls[0][0] as { where: { id: string }; data: Record<string, unknown> };
    expect(args.where).toEqual({ id: user.id });
    expect(Object.keys(args.data).sort()).toEqual(['address1', 'name', 'zipcode']);
    expect(result.name).toBe('새이름');
    expect(result.email).toBe('alice@example.com');
  });

  it('비밀번호 변경은 현재 비밀번호가 틀리면 401, 같으면 400, 맞으면 새 해시를 저장한다', async () => {
    const user = makeUser(await hashPassword(CORRECT_PW));
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.user.update.mockResolvedValue(user);
    await expect(
      service.changePassword(user.id, { currentPassword: WRONG_PW, newPassword: OTHER_PW }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.changePassword(user.id, { currentPassword: CORRECT_PW, newPassword: CORRECT_PW }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    await expect(service.changePassword(user.id, { currentPassword: CORRECT_PW, newPassword: OTHER_PW })).resolves.toEqual({
      changed: true,
    });
    const data = prismaMock.user.update.mock.calls[0][0].data as { passwordHash: string };
    expect(data.passwordHash).not.toBe(OTHER_PW);
    expect(data.passwordHash).not.toBe(user.passwordHash);
  });
});
