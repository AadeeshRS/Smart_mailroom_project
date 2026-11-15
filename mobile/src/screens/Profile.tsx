import { useEffect, useRef, useState } from 'react';
import { useAction } from '../hooks';
import { useSession } from '../session/SessionProvider';
import { Body, Button, Card, Feedback, Field, Heading, Muted, Notice, Page, human } from '../ui';
import { PrivacyNotice } from './PrivacyNotice';
import { ProfileFields } from './ProfileFields';
import { changes, formFrom, rebaseForm } from './profileForm';

export function ProfileScreen() {
  const { api, user, setUser, signOut } = useSession();
  const member = user?.role === 'MEMBER';
  const [form, setForm] = useState(() => formFrom(user ?? undefined));
  const baseline = useRef({ owner: user?.id, form: formFrom(user ?? undefined) });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!user) return;
    const next = formFrom(user);
    const previous = baseline.current;
    baseline.current = { owner: user.id, form: next };
    setForm(current => (previous.owner === user.id ? rebaseForm(current, previous.form, next) : next));
  }, [user]);
  const save = useAction();
  if (!user) return null;
  const edits = changes(form, formFrom(user), member);
  async function submit() {
    const original = form;
    setSaved(false);
    const updated = await save.run(() => api.updateMe(edits));
    if (!updated) return;
    setUser(updated);
    setForm(current => rebaseForm(current, original, formFrom(updated)));
    setSaved(true);
  }
  return (
    <Page title="Profile" subtitle={`${user.name} · ${human(user.role)}`}>
      <Card>
        <Muted>College email (can’t be changed)</Muted>
        <Body>{user.email}</Body>
        <Muted>Name (ask an admin to correct it)</Muted>
        <Body>{user.name}</Body>
      </Card>
      <Card>
        <Heading>Your details</Heading>
        <ProfileFields
          form={form}
          onChange={value => {
            setSaved(false);
            setForm(value);
          }}
          member={member}
        />
        <Feedback error={save.error} />
        {!!saved && !Object.keys(edits).length && <Notice>Saved.</Notice>}
        <Button label="Save changes" onPress={submit} busy={save.busy} disabled={!Object.keys(edits).length} />
      </Card>
      <PasswordCard />
      {member && <PrivacyNotice />}
      <Button label="Sign out" variant="danger" onPress={() => void signOut()} />
    </Page>
  );
}

function PasswordCard() {
  const { api } = useSession();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [done, setDone] = useState(false);
  const change = useAction();
  async function submit() {
    setDone(false);
    if (await change.run(() => api.changePassword({ currentPassword, newPassword }))) {
      setCurrent('');
      setNew('');
      setDone(true);
    }
  }
  return (
    <Card>
      <Heading>Change password</Heading>
      <Field label="Current password" value={currentPassword} onChangeText={setCurrent} secureTextEntry />
      <Field
        label="New password"
        hint="At least 8 characters."
        value={newPassword}
        onChangeText={setNew}
        secureTextEntry
      />
      <Feedback error={change.error} />
      {!!done && <Notice>Password changed. Other devices were signed out.</Notice>}
      <Button
        label="Change password"
        variant="quiet"
        onPress={submit}
        busy={change.busy}
        disabled={!currentPassword || newPassword.length < 8}
      />
    </Card>
  );
}
