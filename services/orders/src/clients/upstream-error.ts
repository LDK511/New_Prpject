/**
 * 내부 서비스(products, mock-payment) 호출이 실패했을 때 던지는 오류입니다.
 * status 가 0 이면 네트워크 오류 또는 타임아웃을 뜻합니다.
 */
export class UpstreamHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamHttpError';
    Object.setPrototypeOf(this, UpstreamHttpError.prototype);
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}
