import { useState } from 'react';
import { Modal } from 'react-native';
import type { Schema } from '../../api/service';
import { useAction, useResource } from '../../hooks';
import { parcelCode } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import { Body, Button, Card, Feedback, Field, Heading, Muted, Page, ResourceState, date } from '../../ui';
import { ParcelCard } from './ParcelCard';

/** A parcel's label details and history; unmatched parcels can be assigned to a member found by search. */
export function ParcelSheet({ parcelId, onClose }: { parcelId: string; onClose: () => void }) {
  const { api } = useSession();
  const detail = useResource(() => api.getParcel({ parcelId }), parcelId);
  const parcel = detail.data?.parcel;
  const assignable = parcel?.status === 'IN_MAILROOM' && !parcel.recipient;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Page modal title={parcel ? parcelCode(parcel) : 'Parcel'} back={onClose}>
        <ResourceState loading={detail.loading && !detail.data} error={detail.error} retry={detail.retry} />
        {!!parcel && (
          <>
            <ParcelCard parcel={parcel} />
            <Card>
              <Heading>Label</Heading>
              <Body>
                {[parcel.labelName, parcel.labelPhone, parcel.labelEmail].filter(Boolean).join(' · ') ||
                  'No contact on the label'}
              </Body>
              <Muted>{[parcel.labelHostel, parcel.labelRoom].filter(Boolean).join(', ')}</Muted>
              {!!parcel.note && <Muted>Note: {parcel.note}</Muted>}
            </Card>
            {!!assignable && <Assign parcelId={parcel.id} onAssigned={detail.retry} />}
            <Card>
              <Heading>History</Heading>
              {detail.data?.history.map(event => (
                <Muted key={event.at + event.action}>
                  {date(event.at)} · {event.action.toLowerCase()} by {event.actor} · {event.detail}
                </Muted>
              ))}
            </Card>
          </>
        )}
      </Page>
    </Modal>
  );
}

function Assign({ parcelId, onAssigned }: { parcelId: string; onAssigned: () => void }) {
  const { api } = useSession();
  const [q, setQ] = useState('');
  const [members, setMembers] = useState<Schema<'MemberSummary'>[]>();
  const search = useAction();
  const assign = useAction();
  async function find() {
    const result = await search.run(() => api.searchMembers({ q: q.trim() }));
    if (result) setMembers(result.items);
  }
  async function pick(userId: string) {
    if (await assign.run(() => api.assignParcel({ parcelId, userId }))) onAssigned();
  }
  return (
    <Card>
      <Heading>Assign to a member</Heading>
      <Field
        label="Find member"
        hint="Name, ID number, phone, room or email."
        value={q}
        onChangeText={setQ}
        onSubmitEditing={find}
      />
      <Button label="Find" variant="quiet" onPress={find} busy={search.busy} disabled={q.trim().length < 2} />
      <Feedback error={search.error || assign.error} />
      {!!members && !members.length && <Muted>No verified member matches.</Muted>}
      {members?.map(m => (
        <Button
          key={m.id}
          label={`Assign to ${m.name}${m.idNumber ? ` · ${m.idNumber}` : ''}${m.roomNumber ? ` · room ${m.roomNumber}` : ''}`}
          variant="quiet"
          onPress={() => void pick(m.id)}
          busy={assign.busy}
        />
      ))}
    </Card>
  );
}
