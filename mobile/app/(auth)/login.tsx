import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ServiceError } from '../../src/api/service';
import { useAction } from '../../src/hooks';
import { useSession } from '../../src/session/SessionProvider';
import { Button, Card, Feedback, Field, Notice, Page } from '../../src/ui';

export default function Login() {
  const { api, signIn } = useSession();
  const router = useRouter();
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [unverified, setUnverified] = useState(false);
  const { run, busy, error } = useAction();

  async function submit() {
    setUnverified(false);
    const session = await run(() =>
      api.login({ email: email.trim(), password }).catch(reason => {
        setUnverified(reason instanceof ServiceError && reason.code === 'EMAIL_NOT_VERIFIED');
        throw reason;
      }),
    );
    if (session) await signIn(session);
  }
  async function verify() {
    if (await run(() => api.resendCode({ email: email.trim() })))
      router.push({ pathname: '/verify-email', params: { email: email.trim() } });
  }

  return (
    <Page title="Sign in" subtitle="Smart Mailroom for your college.">
      {!!notice && <Notice>{notice}</Notice>}
      <Card>
        <Field
          label="College email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="username"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={submit}
        />
        <Feedback error={error} />
        {!!unverified && <Button label="Send me a new code" variant="quiet" onPress={verify} busy={busy} />}
        <Button label="Sign in" onPress={submit} busy={busy} disabled={!email.trim() || !password} />
      </Card>
      <Button label="Create an account" variant="quiet" onPress={() => router.push('/register')} />
      <Button
        label="Forgot password, or set up an invited account"
        variant="quiet"
        onPress={() => router.push('/forgot-password')}
      />
    </Page>
  );
}
