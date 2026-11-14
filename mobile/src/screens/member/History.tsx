import { useResource } from '../../hooks';
import { carrierName, parcelCode } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import { Card, Empty, Heading, Muted, Page, ResourceState, Tag, date } from '../../ui';

/** Parcels the member collected, or that were returned, newest first. */
export function MemberHistory() {
  const { api } = useSession();
  const past = useResource(() => api.listMyParcels({ view: 'history' }));
  const items = past.data?.items ?? [];
  return (
    <Page title="Past parcels" subtitle="Collected or returned, newest first.">
      <ResourceState loading={past.loading && !past.data} error={past.error} retry={past.retry} />
      {!!past.data && !items.length && <Empty title="Nothing yet" detail="Parcels you collect show up here." />}
      {items.map(parcel => (
        <Card key={parcel.id}>
          <Heading>{parcelCode(parcel)}</Heading>
          <Muted>
            {carrierName(parcel.carrier)} · arrived {date(parcel.receivedAt)}
          </Muted>
          <Tag value={parcel.status} />
          {!!parcel.collectedAt && <Muted>Collected {date(parcel.collectedAt)}</Muted>}
        </Card>
      ))}
    </Page>
  );
}
