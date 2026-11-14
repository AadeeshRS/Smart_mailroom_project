import { useState } from 'react';
import type { Schema } from '../../api/service';
import { useAction, useResource } from '../../hooks';
import { carrierName, parcelCode } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import { Button, Card, Empty, Feedback, Heading, Muted, Page, ResourceState, date } from '../../ui';
import { CollectSheet } from './CollectSheet';

/** Parcels waiting for the member at the mailroom. */
export function MemberHome() {
  const { api, user } = useSession();
  const ready = useResource(() => api.listMyParcels({ view: 'ready' }));
  const items = ready.data?.items ?? [];
  const [code, setCode] = useState<Schema<'MyCollection'>>();
  const collect = useAction();
  async function collectNow() {
    const result = await collect.run(() => api.collectNow({}));
    if (result) setCode(result);
  }
  async function cancel() {
    if (await collect.run(() => api.cancelCollection({}))) close();
  }
  function close() {
    setCode(undefined);
    ready.retry();
  }
  return (
    <Page title={`Hello, ${user?.name.split(' ')[0] ?? ''}`} subtitle="Parcels waiting for you at the mailroom.">
      <ResourceState loading={ready.loading && !ready.data} error={ready.error} retry={ready.retry} />
      {!!ready.data && !items.length && (
        <Empty
          title="Nothing waiting"
          detail="When a parcel you requested, or one with your phone number or email, arrives, it shows up here and you get a notification."
        />
      )}
      {!!items.length && (
        <Card>
          <Button label="Collect now" onPress={collectNow} busy={collect.busy} />
          <Muted>One code covers every parcel waiting for you.</Muted>
          {!code && <Feedback error={collect.error} />}
        </Card>
      )}
      {items.map(parcel => (
        <Card key={parcel.id}>
          <Heading>{parcelCode(parcel)}</Heading>
          <Muted>
            {carrierName(parcel.carrier)} · arrived {date(parcel.receivedAt)}
          </Muted>
          <Muted>At the mailroom, tap Collect now, then show your college ID.</Muted>
        </Card>
      ))}
      {!!code && (
        <CollectSheet
          code={code}
          busy={collect.busy}
          error={collect.error}
          onNew={collectNow}
          onCancel={cancel}
          onClose={close}
        />
      )}
    </Page>
  );
}
