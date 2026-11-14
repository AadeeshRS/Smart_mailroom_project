import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAction } from '../../src/hooks';
import { ProfileFields } from '../../src/screens/ProfileFields';
import { formFrom, registration } from '../../src/screens/profileForm';
import { useSession } from '../../src/session/SessionProvider';
import { Button, Card, Feedback, Field, Heading, Muted, Page } from '../../src/ui';

export default function Register() {
  const { api } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [form, setForm] = useState(() => formFrom());
  const { run, busy, error } = useAction();
  const complete = email.trim() && name.trim() && password.length >= 8 && form.idNumber.trim() && form.phone.trim();

  async function submit() {
    const body = { email: email.trim(), name: name.trim(), password, ...registration(form) };
    if (await run(() => api.register(body)))
      router.replace({ pathname: '/verify-email', params: { email: body.email } });
  }

  return (
    <Page title="Create your account" subtitle="For students and college staff." back={() => router.back()}>
      <Card>
        <Heading>Sign-in details</Heading>
        <Field
          label="College email"
          hint="You sign in with this. It can't be changed later."
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <Field
          label="Full name"
          hint="As on your college ID card. It can't be changed later."
          value={name}
          onChangeText={setName}
          autoComplete="name"
        />
        <Field
          label="Password"
          hint="At least 8 characters."
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
      </Card>
      <Card>
        <Heading>How the mailroom finds your parcels</Heading>
        <ProfileFields form={form} onChange={setForm} member />
      </Card>
      <Muted>We’ll email a 6-digit code to your college email to confirm it’s yours.</Muted>
      <Feedback error={error} />
      <Button label="Create account" onPress={submit} busy={busy} disabled={!complete} />
    </Page>
  );
}
