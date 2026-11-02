import nodemailer from 'nodemailer';
import type { AppConfig } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Anything that can send an email. Tests use an in-memory fake instead of SMTP. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Sends real email over SMTP. In development that's Mailpit (inbox: http://localhost:8025). */
export function createSmtpMailer(mail: AppConfig['mail']): Mailer {
  const transport = nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    secure: mail.port === 465,
    auth: mail.user ? { user: mail.user, pass: mail.password } : undefined,
  });
  return {
    async send(message) {
      await transport.sendMail({ from: mail.from, ...message });
    },
  };
}
