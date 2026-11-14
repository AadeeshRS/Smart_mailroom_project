import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import type { Schema } from '../../api/service';
import { useAction } from '../../hooks';
import { CARRIERS, intakeBody, matchText, type Draft } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import { Button, Card, Choice, Feedback, Field, Heading, Notice, Page, date } from '../../ui';

const CARRIER_CHOICES = [...(Object.keys(CARRIERS) as (keyof typeof CARRIERS)[]), 'UNKNOWN'] as const;

/** The lookup panel (kind, carrier, duplicate warning) and the label fields. The draft's id is made once, so
 * pressing Save again after a network error can't log the parcel twice. */
export function IntakeForm({
  lookup,
  shelf,
  onSaved,
  onCancel,
}: {
  lookup: Schema<'Lookup'>;
  shelf: string;
  onSaved: (parcel: Schema<'OperatorParcel'>, draft: Draft) => void;
  onCancel: () => void;
}) {
  const { api } = useSession();
  const [draft, setDraft] = useState<Draft>(() => ({
    id: randomUUID(),
    kind: lookup.kind,
    code: lookup.code,
    otherCode: '',
    carrier: lookup.carrier ?? 'UNKNOWN',
    labelName: '',
    labelPhone: '',
    labelEmail: '',
    labelHostel: '',
    labelRoom: '',
    shelf,
    note: '',
  }));
  const save = useAction();
  const set = (field: keyof Draft) => (value: string) => setDraft({ ...draft, [field]: value });

  async function submit() {
    const parcel = await save.run(() => api.intakeParcel(intakeBody(draft)));
    if (parcel) onSaved(parcel, draft);
  }

  return (
    <Page title="Label details" subtitle={lookup.code} back={onCancel}>
      {!!lookup.existing.length && (
        <Notice danger>
          {`Already logged ${lookup.existing.length === 1 ? 'once' : `${lookup.existing.length} times`}: `}
          {lookup.existing.map(p => `${date(p.receivedAt)}, shelf ${p.shelf}, ${matchText(p)}`).join('; ')}. Check it
          isn’t the same parcel.
        </Notice>
      )}
      <Card>
        <Choice
          label="This code is"
          values={['AWB', 'ORDER_ID'] as const}
          value={draft.kind}
          onChange={set('kind')}
          names={{ AWB: 'AWB / tracking number', ORDER_ID: 'Order ID' }}
        />
        <Choice
          label="Carrier"
          values={CARRIER_CHOICES}
          value={draft.carrier}
          onChange={set('carrier')}
          names={{ ...CARRIERS, UNKNOWN: 'Not sure' }}
        />
        <Field
          label={draft.kind === 'AWB' ? 'Order ID (optional)' : 'AWB (optional)'}
          value={draft.otherCode}
          onChangeText={set('otherCode')}
          autoCapitalize="characters"
        />
      </Card>
      <Card>
        <Heading>From the label</Heading>
        <Field label="Name" value={draft.labelName} onChangeText={set('labelName')} />
        <Field label="Phone" value={draft.labelPhone} onChangeText={set('labelPhone')} keyboardType="phone-pad" />
        <Field
          label="Email"
          value={draft.labelEmail}
          onChangeText={set('labelEmail')}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field label="Hostel" value={draft.labelHostel} onChangeText={set('labelHostel')} />
        <Field label="Room" value={draft.labelRoom} onChangeText={set('labelRoom')} />
      </Card>
      <Card>
        <Field label="Shelf" value={draft.shelf} onChangeText={set('shelf')} autoCapitalize="characters" />
        <Field label="Note (optional)" value={draft.note} onChangeText={set('note')} />
        <Feedback error={save.error} />
        <Button label="Save parcel" onPress={submit} busy={save.busy} disabled={!draft.shelf.trim()} />
      </Card>
    </Page>
  );
}
