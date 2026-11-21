import { SetMetadata } from '@nestjs/common';

export const TOKEN_TYPE_KEY = 'tokenType';

export type TokenKind = 'access' | 'service';

/**
 * 경로가 받아들이는 토큰 종류를 지정합니다. 지정하지 않으면 'access' 입니다.
 * - 'access': 회원 서비스가 발급한 사용자 토큰
 * - 'service': orders 서비스가 서명한 내부 호출용 토큰 (/internal/*)
 */
export const TokenType = (t: TokenKind) => SetMetadata(TOKEN_TYPE_KEY, t);
