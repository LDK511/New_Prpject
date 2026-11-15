import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';

/** orders 서비스가 events:orders 스트림에 발행하는 order.paid 이벤트 본문 */
export interface OrderPaidEvent {
  orderId: string;
  userId: string;
  email: string;
  totalAmount: number;
  currency: string;
  items: { productName: string; quantity: number; unitPrice: number; lineTotal: number }[];
  paidAt: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAmount(amount: number, currency: string): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `${n.toLocaleString('ko-KR')} ${currency || 'KRW'}`;
}

@Injectable()
export class MailerService implements OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST || 'localhost';
    const port = Number(process.env.SMTP_PORT || 1025);
    const secure = (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    this.from = process.env.MAIL_FROM || 'Shop <no-reply@shop.local>';

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    this.logger.log(`SMTP 설정: ${host}:${port} (secure=${secure})`);
  }

  buildSubject(event: OrderPaidEvent): string {
    return `[주문 완료] 주문 ${event.orderId}`;
  }

  buildText(event: OrderPaidEvent): string {
    const lines = (event.items || []).map(
      (i) =>
        `- ${i.productName} x ${i.quantity} (단가 ${formatAmount(i.unitPrice, event.currency)}) = ${formatAmount(i.lineTotal, event.currency)}`,
    );
    return [
      '주문이 완료되었습니다. (테스트 결제)',
      '',
      `주문 번호: ${event.orderId}`,
      `결제 시각: ${event.paidAt}`,
      '',
      '주문 상품:',
      ...lines,
      '',
      `합계: ${formatAmount(event.totalAmount, event.currency)}`,
    ].join('\n');
  }

  buildHtml(event: OrderPaidEvent): string {
    const rows = (event.items || [])
      .map(
        (i) =>
          `<tr><td>${escapeHtml(String(i.productName))}</td><td style="text-align:right">${i.quantity}</td>` +
          `<td style="text-align:right">${escapeHtml(formatAmount(i.unitPrice, event.currency))}</td>` +
          `<td style="text-align:right">${escapeHtml(formatAmount(i.lineTotal, event.currency))}</td></tr>`,
      )
      .join('');
    return (
      `<h2>주문이 완료되었습니다 (테스트 결제)</h2>` +
      `<p>주문 번호: <strong>${escapeHtml(event.orderId)}</strong><br/>결제 시각: ${escapeHtml(String(event.paidAt))}</p>` +
      `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">` +
      `<thead><tr><th>상품</th><th>수량</th><th>단가</th><th>금액</th></tr></thead>` +
      `<tbody>${rows}</tbody>` +
      `<tfoot><tr><td colspan="3"><strong>합계</strong></td><td style="text-align:right"><strong>${escapeHtml(
        formatAmount(event.totalAmount, event.currency),
      )}</strong></td></tr></tfoot>` +
      `</table>`
    );
  }

  /** 주문 완료 메일을 보냅니다. 실패하면 throw 해서 BullMQ 가 재시도하게 합니다. */
  async sendOrderPaid(event: OrderPaidEvent): Promise<void> {
    if (!event || typeof event.email !== 'string' || !event.email.includes('@')) {
      throw new Error('INVALID_RECIPIENT');
    }
    const info = await this.transporter.sendMail({
      from: this.from,
      to: event.email,
      subject: this.buildSubject(event),
      text: this.buildText(event),
      html: this.buildHtml(event),
    });
    this.logger.log(`메일 발송 완료: order=${event.orderId} messageId=${String(info.messageId)}`);
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
