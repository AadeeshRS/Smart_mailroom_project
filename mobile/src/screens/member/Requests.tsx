import { useState } from 'react';
import type { Schema } from '../../api/service';
import { useAction, useResource } from '../../hooks';
import { carrierName, cleanOtp, requestBody, requestText, type RequestDraft } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import { Body, Button, Card, Empty, Feedback, Field, Heading, Muted, Page, ResourceState, Tag, date } from '../../ui';

const BLANK: RequestDraft = { awb: '', orderId: '', deliveryOtp: '' };
const OTP_HINT = 'The code the courier sent you. The mailroom reads it out to the delivery partner.';

/** Ask for a parcel by its AWB (W6), with the courier's delivery OTP if there is one (W8). */
export function MemberRequests() {
  const { api } = useSession();
  const list = useResource(() => api.listMyRequests({}));
  const [draft, setDraft] = useState(BLANK);
  const [added, setAdded] = useState<Schema<'MyRequest'>>();
  const save = useAction();
  const set = (field: keyof RequestDraft) => (value: string) => setDraft({ ...draft, [field]: value });

  async function submit() {
    const request = await save.run(() => api.createRequest(requestBody(draft)));
    if (!request) return;
    setDraft(BLANK);
    setAdded(request);
  }

  const items = list.data?.items ?? [];
  return (
    <Page title="Requests" subtitle="Expecting a parcel? Add its AWB and it’s linked to you when it arrives.">
      <Card>
        <Field
          label="AWB / tracking number"
          value={draft.awb}
          onChangeText={set('awb')}
          autoCapitalize="characters"
          editable={!save.busy}
        />
        <Field
          label="Order ID (optional)"
          editable={!save.busy}
          value={draft.orderId}
          onChangeText={set('orderId')}
          autoCapitalize="characters"
        />
        <Field
          label="Delivery OTP (optional)"
          editable={!save.busy}
          hint={OTP_HINT}
          value={draft.deliveryOtp}
          onChangeText={set('deliveryOtp')}
          keyboardType="number-pad"
        />
        <Feedback error={save.error} />
        <Button label="Add request" onPress={submit} busy={save.busy} disabled={!draft.awb.trim()} />
        {!!added && <Muted>{`Added ${added.awb}. ${requestText(added)}`}</Muted>}
      </Card>
      <ResourceState loading={list.loading && !list.data} error={list.error} retry={list.retry} />
      {!!list.data && !items.length && <Empty title="No requests" detail="Requests you add show up here." />}
      {items.map(request => (
        <RequestCard key={request.id} request={request} />
      ))}
    </Page>
  );
}

/** Its writes need no re-read here: a successful write refreshes the open screens (api/http.ts). */
function RequestCard({ request }: { request: Schema<'MyRequest'> }) {
  const { api } = useSession();
  const [otp, setOtp] = useState(request.deliveryOtp ?? '');
  const change = useAction();
  const requestId = request.id;
  async function saveOtp() {
    await change.run(() => api.updateRequest({ requestId, deliveryOtp: cleanOtp(otp) }));
  }
  async function cancel() {
    await change.run(() => api.cancelRequest({ requestId }));
  }
  const open = request.status === 'OPEN';
  return (
    <Card>
      <Heading>{request.awb}</Heading>
      <Muted>
        {[
          carrierName(request.carrier),
          request.orderId && `order ${request.orderId}`,
          `added ${date(request.createdAt)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Muted>
      <Tag value={request.status} />
      <Body>{requestText(request)}</Body>
      {open && (
        <>
          <Muted>Expires {date(request.expiresAt)} if nothing arrives.</Muted>
          <Field
            label="Delivery OTP"
            hint={OTP_HINT}
            value={otp}
            onChangeText={setOtp}
            keyboardType="number-pad"
            editable={!change.busy}
          />
          <Feedback error={change.error} />
          <Button
            label="Save OTP"
            variant="quiet"
            onPress={saveOtp}
            busy={change.busy}
            disabled={cleanOtp(otp) === request.deliveryOtp}
          />
          <Button label="Cancel request" variant="quiet" onPress={cancel} busy={change.busy} />
        </>
      )}
    </Card>
  );
}
