import { randomUUID } from 'expo-crypto';
import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { ServiceError, type Schema } from '../../api/service';
import { useAction, useResource } from '../../hooks';
import { CARRIERS, intakeBody, matchText, memberLine, type Draft } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import { Body, Button, Card, Choice, Feedback, Field, Heading, Muted, Notice, Page, date, styles } from '../../ui';

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
  const latest = useResource(() => api.lookupParcel({ code: lookup.code }), lookup.code);
  const current = latest.data ?? lookup;
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
  const submitted = useRef<Draft | undefined>(undefined);
  const uncertain = !!submitted.current && !!save.error;
  const locked = save.busy || uncertain;
  // After an interrupted save, Back still works, but asks first: the parcel may already be logged (WS-13).
  const [leaving, setLeaving] = useState(false);
  const back = () => (uncertain && !leaving ? setLeaving(true) : onCancel());
  const set = (field: keyof Draft) => (value: string) => {
    if (!locked) setDraft(current => ({ ...current, [field]: value }));
  };

  async function submit() {
    const original = submitted.current ?? { ...draft };
    submitted.current = original;
    const parcel = await save.run(async () => {
      try {
        return await api.intakeParcel(intakeBody(original));
      } catch (error) {
        if (error instanceof ServiceError && error.code !== 'NETWORK' && error.code !== 'INTERNAL')
          submitted.current = undefined;
        throw error;
      }
    });
    if (parcel) onSaved(parcel, original);
  }

  return (
    <Page title="Label details" subtitle={lookup.code} back={save.busy ? undefined : back}>
      {leaving && uncertain && (
        <Notice>
          This parcel may already be saved: the connection dropped after it was sent. Tap Back again to leave, then
          search Parcels for this code before logging it again.
        </Notice>
      )}
      {uncertain && (
        <Notice>
          The connection was interrupted. Retry Save parcel with these original details to check whether it was
          received. This avoids logging it twice.
        </Notice>
      )}
      {!!current.existing.length && (
        <Notice danger>
          {`Already logged ${current.existing.length === 1 ? 'once' : `${current.existing.length} times`}: `}
          {current.existing.map(p => `${date(p.receivedAt)}, shelf ${p.shelf}, ${matchText(p)}`).join('; ')}. Check it
          isn’t the same parcel.
        </Notice>
      )}
      {!!current.request && <RequestBanner request={current.request} />}
      <Card>
        <Choice
          label="This code is"
          disabled={locked}
          values={['AWB', 'ORDER_ID'] as const}
          value={draft.kind}
          onChange={set('kind')}
          names={{ AWB: 'AWB / tracking number', ORDER_ID: 'Order ID' }}
        />
        <Choice
          label="Carrier"
          disabled={locked}
          values={CARRIER_CHOICES}
          value={draft.carrier}
          onChange={set('carrier')}
          names={{ ...CARRIERS, UNKNOWN: 'Not sure' }}
        />
        <Field
          label={draft.kind === 'AWB' ? 'Order ID (optional)' : 'AWB (optional)'}
          editable={!locked}
          value={draft.otherCode}
          onChangeText={set('otherCode')}
          autoCapitalize="characters"
        />
      </Card>
      <Card>
        <Heading>From the label</Heading>
        <Field label="Name" value={draft.labelName} onChangeText={set('labelName')} editable={!locked} />
        <Field
          label="Phone"
          value={draft.labelPhone}
          onChangeText={set('labelPhone')}
          keyboardType="phone-pad"
          editable={!locked}
        />
        <Field
          label="Email"
          editable={!locked}
          value={draft.labelEmail}
          onChangeText={set('labelEmail')}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field label="Hostel" value={draft.labelHostel} onChangeText={set('labelHostel')} editable={!locked} />
        <Field label="Room" value={draft.labelRoom} onChangeText={set('labelRoom')} editable={!locked} />
      </Card>
      <Card>
        <Field
          label="Shelf"
          value={draft.shelf}
          onChangeText={set('shelf')}
          autoCapitalize="characters"
          editable={!locked}
        />
        <Field label="Note (optional)" value={draft.note} onChangeText={set('note')} editable={!locked} />
        <Feedback error={save.error} />
        <Button label="Save parcel" onPress={submit} busy={save.busy} disabled={!draft.shelf.trim()} />
      </Card>
    </Page>
  );
}

/** W8: the member's open request for this code, with the delivery OTP to read out to the delivery partner. */
function RequestBanner({ request }: { request: Schema<'LookupRequest'> }) {
  const { member, deliveryOtp } = request;
  return (
    <Card>
      <Heading>Requested by {member.name}</Heading>
      <Muted>{memberLine(member)}</Muted>
      {deliveryOtp ? (
        <>
          <Body>Delivery OTP: read it out to the delivery partner.</Body>
          <Text
            style={[styles.title, { letterSpacing: 6 }]}
            accessibilityLabel={`Delivery OTP ${[...deliveryOtp].join(' ')}`}
          >
            {deliveryOtp}
          </Text>
        </>
      ) : (
        <Muted>The member didn’t add a delivery OTP.</Muted>
      )}
    </Card>
  );
}
