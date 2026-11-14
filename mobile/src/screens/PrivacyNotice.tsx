import { Card, Heading, Muted } from '../ui';

/** Keep in step with RETENTION_DAYS on the server (default 90; docs/DEPLOYMENT.md). */
const RETENTION_DAYS = 90;

/** Plan 8.5 (F36). Shown at registration, where the member ticks that they've read it, and on their Profile. */
export function PrivacyNotice() {
  return (
    <Card>
      <Heading>Privacy notice</Heading>
      <Muted>
        What we keep: your name, college email, whether you’re a student or staff, ID number, phone numbers, personal
        email (if you add one), hostel and room. For each parcel: its tracking or order number and what the label shows
        (name, phone, email, hostel, room).
      </Muted>
      <Muted>
        Why: to match parcels to you, tell you when one arrives, and check your college ID when you collect it.
      </Muted>
      <Muted>
        Who sees it: only the college mailroom’s staff. It isn’t sold or shared. Codes are emailed through our email
        provider, and notifications go through Expo’s push service and Apple or Google.
      </Muted>
      <Muted>
        {`How long: label details are erased ${RETENTION_DAYS} days after a parcel is collected or returned; the record that it was handed over stays. Your account details stay while you have an account. You can correct them in Profile; to close your account, ask a mailroom admin.`}
      </Muted>
    </Card>
  );
}
