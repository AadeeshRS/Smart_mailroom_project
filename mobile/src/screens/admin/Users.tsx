import { useState } from 'react';
import { Modal } from 'react-native';
import type { Schema } from '../../api/service';
import { useAction, useResource } from '../../hooks';
import { memberLine } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import { Body, Button, Card, Choice, Empty, Feedback, Field, Heading, Muted, Page, ResourceState, Tag } from '../../ui';

type Role = Schema<'Role'>;
const ROLES = { MEMBER: 'Member', OPERATOR: 'Operator', ADMIN: 'Admin' };

/** Find users, change roles, (de)activate, and invite operators and admins. */
export function AdminUsers({ onClose }: { onClose: () => void }) {
  const { api } = useSession();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | 'ALL'>('ALL');
  const query = { limit: 100, ...(q ? { q } : {}), ...(role === 'ALL' ? {} : { role }) };
  const users = useResource(() => api.listUsers(query), JSON.stringify(query));
  const items = users.data?.items ?? [];
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Page modal title="Users" back={onClose}>
        <Invite />
        <Card>
          <Field
            label="Search users"
            hint="Name, email, ID number or phone."
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => setQ(text.trim())}
            autoCapitalize="none"
          />
          <Button label="Search" variant="quiet" onPress={() => setQ(text.trim())} />
          <Choice
            label="Role"
            values={['ALL', 'MEMBER', 'OPERATOR', 'ADMIN'] as const}
            value={role}
            onChange={setRole}
            names={{ ALL: 'All', ...ROLES }}
          />
        </Card>
        <ResourceState loading={users.loading && !users.data} error={users.error} retry={users.retry} />
        {!!users.data && !items.length && <Empty title="No users" detail="Nobody matches this search." />}
        {items.map(user => (
          <UserCard key={user.id} user={user} />
        ))}
        {!!users.data?.nextCursor && <Muted>Showing the first 100. Search to narrow it down.</Muted>}
      </Page>
    </Modal>
  );
}

function Invite() {
  const { api } = useSession();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'OPERATOR' | 'ADMIN'>('OPERATOR');
  const [sent, setSent] = useState('');
  const create = useAction();
  async function submit() {
    const user = await create.run(() => api.createUser({ email: email.trim(), name: name.trim(), role }));
    if (!user) return;
    setSent(user.email);
    setEmail('');
    setName('');
  }
  return (
    <Card>
      <Heading>Add an operator or admin</Heading>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Name" value={name} onChangeText={setName} />
      <Choice
        label="Role for the new user"
        values={['OPERATOR', 'ADMIN'] as const}
        value={role}
        onChange={setRole}
        names={ROLES}
      />
      <Feedback error={create.error} />
      <Button
        label="Add and email a code"
        onPress={submit}
        busy={create.busy}
        disabled={!email.trim() || !name.trim()}
      />
      {!!sent && <Muted>{`Added ${sent}. They set a password with the emailed code (Forgot password).`}</Muted>}
    </Card>
  );
}

function UserCard({ user }: { user: Schema<'User'> }) {
  const { api } = useSession();
  const change = useAction();
  const userId = user.id;
  async function update(body: { role?: Role; active?: boolean }) {
    await change.run(() => api.updateUser({ userId, ...body }));
  }
  return (
    <Card>
      <Heading>{user.name}</Heading>
      <Muted>{[user.email, memberLine(user)].filter(Boolean).join(' · ')}</Muted>
      <Tag value={user.active ? user.role : 'INACTIVE'} />
      {!user.emailVerified && <Body>Hasn’t verified their email or set a password yet.</Body>}
      <Choice
        label={`Role for ${user.name}`}
        values={['MEMBER', 'OPERATOR', 'ADMIN'] as const}
        value={user.role}
        onChange={role => void update({ role })}
        names={ROLES}
      />
      <Feedback error={change.error} />
      <Button
        label={user.active ? 'Deactivate' : 'Reactivate'}
        variant={user.active ? 'danger' : 'quiet'}
        onPress={() => void update({ active: !user.active })}
        busy={change.busy}
      />
    </Card>
  );
}
