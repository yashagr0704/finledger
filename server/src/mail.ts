import nodemailer from 'nodemailer';
import type { Config } from './config';

/** Sends email when SMTP_URL is configured; otherwise reports that it didn't. */
export function makeMailer(config: Config) {
  const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;
  return {
    enabled: !!transport,
    async send(to: string, subject: string, text: string) {
      if (!transport) return false;
      await transport.sendMail({ from: config.mailFrom, to, subject, text });
      return true;
    },
  };
}
export type Mailer = ReturnType<typeof makeMailer>;
