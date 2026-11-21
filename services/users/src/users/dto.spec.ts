import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ChangePasswordDto, SignupDto, UpdateProfileDto } from './dto';

const base = { email: 'A@Example.com ', password: 'abcd1234', name: ' 홍길동 ', agreeTerms: true, agreePrivacy: true };
const errorsOf = (cls: new () => object, plain: object): string[] =>
  validateSync(plainToInstance(cls, plain) as object, { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);

describe('SignupDto', () => {
  it('정상 입력을 받아들이고 이메일·이름·전화번호를 정리한다', () => {
    const dto = plainToInstance(SignupDto, { ...base, phone: '010-1234-5678' });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.email).toBe('a@example.com');
    expect(dto.name).toBe('홍길동');
    expect(dto.phone).toBe('01012345678');
  });

  it('약관 미동의·약한 비밀번호·이름 없음·잘못된 전화번호를 거절한다', () => {
    expect(errorsOf(SignupDto, { ...base, agreeTerms: false })).toEqual(['agreeTerms']);
    expect(errorsOf(SignupDto, { ...base, agreePrivacy: undefined })).toEqual(['agreePrivacy']);
    expect(errorsOf(SignupDto, { ...base, password: 'abcdefgh' })).toEqual(['password']);
    expect(errorsOf(SignupDto, { ...base, password: '12345678' })).toEqual(['password']);
    expect(errorsOf(SignupDto, { ...base, password: 'ab12' })).toEqual(['password']);
    expect(errorsOf(SignupDto, { ...base, name: '  ' })).toEqual(['name']);
    expect(errorsOf(SignupDto, { ...base, phone: '12345' })).toEqual(['phone']);
    expect(errorsOf(SignupDto, { ...base, role: 'ADMIN' })).toEqual(['role']);
  });
});

describe('UpdateProfileDto / ChangePasswordDto', () => {
  it('빈 값으로 지우기는 허용하고 형식이 틀리면 거절한다', () => {
    expect(errorsOf(UpdateProfileDto, { phone: '', zipcode: '', address1: '' })).toEqual([]);
    expect(errorsOf(UpdateProfileDto, { zipcode: '123' })).toEqual(['zipcode']);
    expect(errorsOf(UpdateProfileDto, { email: 'x@y.z' })).toEqual(['email']);
    expect(errorsOf(ChangePasswordDto, { currentPassword: 'x', newPassword: 'short1' })).toEqual(['newPassword']);
    expect(errorsOf(ChangePasswordDto, { currentPassword: 'x', newPassword: 'longenough1' })).toEqual([]);
  });
});
