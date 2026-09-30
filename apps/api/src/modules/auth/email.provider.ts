import { env } from '../../config/env.js';

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  send(message: TransactionalEmail): Promise<void>;
}

export class TestEmailProvider implements EmailProvider {
  readonly messages: TransactionalEmail[] = [];
  async send(message: TransactionalEmail) {
    this.messages.push(message);
  }
}

class ConsoleEmailProvider implements EmailProvider {
  async send(message: TransactionalEmail) {
    console.info(JSON.stringify({
      event: 'development_transactional_email',
      to: message.to,
      subject: message.subject,
      text: message.text,
    }));
  }
}

/** RFC 2606 / 6761 reserved names (mock and smoke accounts) can never receive real email. */
export const isReservedEmailAddress = (address: string) =>
  /\.(test|invalid|example|localhost)$/i.test(address.trim().split('@').pop() ?? '')
  || /@(example\.(com|net|org))$/i.test(address.trim());

class PostmarkEmailProvider implements EmailProvider {
  async send(message: TransactionalEmail) {
    if (isReservedEmailAddress(message.to)) {
      console.info(JSON.stringify({ event: 'reserved_address_email_skipped', subject: message.subject }));
      return;
    }
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN!,
      },
      body: JSON.stringify({
        From: env.EMAIL_FROM,
        To: message.to,
        Subject: message.subject,
        TextBody: message.text,
        ...(message.html ? { HtmlBody: message.html } : {}),
        MessageStream: 'outbound',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Postmark delivery failed with status ${response.status}`);
  }
}

export const createEmailProvider = (): EmailProvider => {
  if (env.EMAIL_PROVIDER === 'postmark') return new PostmarkEmailProvider();
  if (env.EMAIL_PROVIDER === 'test') return new TestEmailProvider();
  return new ConsoleEmailProvider();
};
