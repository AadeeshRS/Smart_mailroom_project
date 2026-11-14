import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAction } from '../../src/hooks';
import { useSession } from '../../src/session/SessionProvider';
import { Button, Card, Feedback, Field, Muted, Page } from '../../src/ui';

/** Reset a forgotten password; invited operators and admins set their first password here too. */
export default function ForgotPassword() {
  const { api } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const { run, busy, error } = useAction();

  async function send() {
    if (await run(() => api.forgotPassword({ email: email.trim() }))) setSent(true);
  }
  async function reset() {
    if (await run(() => api.resetPassword({ email: email.trim(), code, password })))
      router.replace({ pathname: '/login', params: { notice: 'Password set. Sign in with your new password.' } });
  }

  return (
    <Page title="Set a new password" back={() => router.back()}>
      <Card>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          editable={!sent}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        {!sent ? (
          <>
            <Feedback error={error} />
            <Button label="Email me a code" onPress={send} busy={busy} disabled={!email.trim()} />
          </>
        ) : (
          <>
            <Muted>If an account uses this email, a 6-digit code is on its way. It works for 10 minutes.</Muted>
            <Field
              label="Code"
              value={code}
              onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
            />
            <Field
              label="New password"
              hint="At least 8 characters."
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
            />
            <Feedback error={error} />
            <Button
              label="Set password"
              onPress={reset}
              busy={busy}
              disabled={code.length !== 6 || password.length < 8}
            />
            <Button label="Send another code" variant="quiet" onPress={send} busy={busy} />
          </>
        )}
      </Card>
    </Page>
  );
}
