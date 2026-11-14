import { useResource } from '../../hooks';
import { carrierName, parcelCode } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import { Card, Empty, Heading, Muted, Page, ResourceState, date } from '../../ui';

/** Parcels waiting for the member at the mailroom. */
export function MemberHome() {
  const { api, user } = useSession();
  const ready = useResource(() => api.listMyParcels({ view: 'ready' }));
  const items = ready.data?.items ?? [];
  return (
    <Page title={`Hello, ${user?.name.split(' ')[0] ?? ''}`} subtitle="Parcels waiting for you at the mailroom.">
      <ResourceState loading={ready.loading && !ready.data} error={ready.error} retry={ready.retry} />
      {!!ready.data && !items.length && (
        <Empty
          title="Nothing waiting"
          detail="When a parcel with your phone number or email arrives, it shows up here and you get a notification."
        />
      )}
      {items.map(parcel => (
        <Card key={parcel.id}>
          <Heading>{parcelCode(parcel)}</Heading>
          <Muted>
            {carrierName(parcel.carrier)} · arrived {date(parcel.receivedAt)}
          </Muted>
          <Muted>Bring your college ID to the mailroom to collect it.</Muted>
        </Card>
      ))}
    </Page>
  );
}
