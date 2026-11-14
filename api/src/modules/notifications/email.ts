import type { Config } from '../../core/config.js';

export type Mailer = { send(to: string, subject: string, text: string): Promise<void> };

/** Resend's HTTP API with plain fetch when a key is configured, otherwise the console.
 * config() refuses to start production without a key, so the console provider is dev/test only. */
export function mailer(config: Config, fetcher: typeof fetch = fetch): Mailer {
  if (!config.resendApiKey)
    return {
      send: async (to, subject, text) => console.log(`[email to ${to}] ${subject}\n${text}`),
    };
  return {
    async send(to, subject, text) {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Resend rejected the email: HTTP ${response.status}`);
    },
  };
}
