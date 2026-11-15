import { useState } from 'react';
import { Modal } from 'react-native';
import type { Schema } from '../../api/service';
import { useAction, useResource } from '../../hooks';
import { useSession } from '../../session/SessionProvider';
import { Button, Card, Empty, Feedback, Field, Heading, Page, ResourceState, Tag } from '../../ui';

/** The hostel list members pick from: add, rename, (de)activate. */
export function AdminHostels({ onClose }: { onClose: () => void }) {
  const { api } = useSession();
  const hostels = useResource(() => api.listHostels({}));
  const [name, setName] = useState('');
  const add = useAction();
  async function submit() {
    if (await add.run(() => api.createHostel({ name: name.trim() }))) setName('');
  }
  const items = hostels.data?.items ?? [];
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Page modal title="Hostels" back={onClose}>
        <Card>
          <Field label="New hostel" value={name} onChangeText={setName} onSubmitEditing={submit} />
          <Feedback error={add.error} />
          <Button label="Add hostel" onPress={submit} busy={add.busy} disabled={!name.trim()} />
        </Card>
        <ResourceState loading={hostels.loading && !hostels.data} error={hostels.error} retry={hostels.retry} />
        {!!hostels.data && !items.length && <Empty title="No hostels yet" detail="Add the first one above." />}
        {items.map(hostel => (
          <HostelCard key={hostel.id + hostel.name} hostel={hostel} />
        ))}
      </Page>
    </Modal>
  );
}

function HostelCard({ hostel }: { hostel: Schema<'Hostel'> }) {
  const { api } = useSession();
  const [name, setName] = useState(hostel.name);
  const change = useAction();
  const hostelId = hostel.id;
  async function update(body: { name?: string; active?: boolean }) {
    await change.run(() => api.updateHostel({ hostelId, ...body }));
  }
  return (
    <Card>
      <Heading>{hostel.name}</Heading>
      <Tag value={hostel.active ? 'ACTIVE' : 'INACTIVE'} />
      <Field label={`Rename ${hostel.name}`} value={name} onChangeText={setName} />
      <Feedback error={change.error} />
      <Button
        label="Save name"
        variant="quiet"
        onPress={() => void update({ name: name.trim() })}
        busy={change.busy}
        disabled={!name.trim() || name.trim() === hostel.name}
      />
      <Button
        label={hostel.active ? 'Hide from registration' : 'Show in registration'}
        variant="quiet"
        onPress={() => void update({ active: !hostel.active })}
        busy={change.busy}
      />
    </Card>
  );
}
