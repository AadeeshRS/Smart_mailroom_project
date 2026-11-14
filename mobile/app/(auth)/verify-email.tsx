import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useAction } from '../../src/hooks';
import { useSession } from '../../src/session/SessionProvider';
import { Button, Card, Feedback, Field, Muted, Notice, Page } from '../../src/ui';

export default function VerifyEmail() {
  const { api, signIn } = useSession();
  const router = useRouter();
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const verify = useAction();
  const resend = useAction();

  async function submit() {
    const session = await verify.run(() => api.verifyEmail({ email, code }));
    if (session) await signIn(session);
  }
  async function again() {
    setResent(false);
    if (await resend.run(() => api.resendCode({ email }))) setResent(true);
  }

  return (
    <Page title="Check your email" back={() => router.replace('/login')}>
      <Card>
        <Muted>We sent a 6-digit code to {email}. It works for 10 minutes.</Muted>
        <Field
          label="Code"
          value={code}
          onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          onSubmitEditing={submit}
        />
        <Feedback error={verify.error || resend.error} />
        {!!resent && <Notice>A new code is on its way.</Notice>}
        <Button label="Verify" onPress={submit} busy={verify.busy} disabled={code.length !== 6} />
        <Button label="Send a new code" variant="quiet" onPress={again} busy={resend.busy} />
      </Card>
    </Page>
  );
}
