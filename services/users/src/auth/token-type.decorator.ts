import { SetMetadata } from '@nestjs/common';

export const TOKEN_TYPE_KEY = 'tokenType';

export type TokenKind = 'access' | 'service';

export const TokenType = (t: TokenKind) => SetMetadata(TOKEN_TYPE_KEY, t);
