import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
/** 전화번호는 숫자만 남겨 저장합니다(010-1234-5678 → 01012345678). */
const digitsOnly = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;

/** 영문과 숫자를 모두 포함해야 합니다(길이는 @Length 로 따로 검사). */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/;
export const PASSWORD_RULE_MESSAGE = 'password must contain letters and numbers';
export const PHONE_RULE = /^0\d{8,10}$/;

export class SignupDto {
  @Transform(normalizeEmail)
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(8, 72)
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  password!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 50)
  name!: string;

  @IsOptional()
  @Transform(digitsOnly)
  @IsString()
  @Matches(PHONE_RULE, { message: 'phone must be a valid phone number' })
  phone?: string;

  /** 이용약관·개인정보 수집 동의(필수). true 가 아니면 가입할 수 없습니다. */
  @Equals(true, { message: 'agreeTerms must be accepted' })
  agreeTerms!: boolean;

  @Equals(true, { message: 'agreePrivacy must be accepted' })
  agreePrivacy!: boolean;

  @IsOptional()
  @IsBoolean()
  marketingAgreed?: boolean;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}

export class CheckEmailQueryDto {
  @Transform(normalizeEmail)
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  name?: string;

  @IsOptional()
  @Transform(digitsOnly)
  @IsString()
  @Matches(/^(0\d{8,10})?$/, { message: 'phone must be a valid phone number' })
  phone?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^(\d{5})?$/, { message: 'zipcode must be 5 digits' })
  zipcode?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  address1?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  address2?: string;

  @IsOptional()
  @IsBoolean()
  marketingAgreed?: boolean;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @Length(8, 72)
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  newPassword!: string;
}

export interface UserDto {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  name: string;
  phone: string;
  zipcode: string;
  address1: string;
  address2: string;
  marketingAgreed: boolean;
  createdAt: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: UserDto;
}

export interface UserRowLike {
  id: string;
  email: string;
  role: string;
  name?: string | null;
  phone?: string | null;
  zipcode?: string | null;
  address1?: string | null;
  address2?: string | null;
  marketingAgreed?: boolean | null;
  createdAt: Date;
}

export function toUserDto(u: UserRowLike): UserDto {
  return {
    id: u.id,
    email: u.email,
    role: u.role === 'ADMIN' ? 'ADMIN' : 'USER',
    name: u.name ?? '',
    phone: u.phone ?? '',
    zipcode: u.zipcode ?? '',
    address1: u.address1 ?? '',
    address2: u.address2 ?? '',
    marketingAgreed: u.marketingAgreed === true,
    createdAt: u.createdAt.toISOString(),
  };
}
