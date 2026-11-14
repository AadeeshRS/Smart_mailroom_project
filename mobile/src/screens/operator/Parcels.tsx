import { useState } from 'react';
import type { Schema } from '../../api/service';
import { useAction, useResource } from '../../hooks';
import { useSession } from '../../session/SessionProvider';
import { Button, Card, Choice, Empty, Feedback, Field, Page, ResourceState } from '../../ui';
import { ParcelCard } from './ParcelCard';
import { ParcelSheet } from './ParcelSheet';

type Filter = 'IN_MAILROOM' | 'UNMATCHED' | 'ALL';
const FILTERS = { IN_MAILROOM: 'In the mailroom', UNMATCHED: 'Unmatched', ALL: 'All' };

/** Search parcels; tap one for details, history and manual assign. */
export function ParcelsScreen() {
  const { api } = useSession();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('IN_MAILROOM');
  const [open, setOpen] = useState<string>();
  const query = {
    ...(q ? { q } : {}),
    ...(filter === 'ALL' ? {} : { status: 'IN_MAILROOM' as const }),
    ...(filter === 'UNMATCHED' ? { unmatched: true } : {}),
  };
  const key = JSON.stringify(query);
  const first = useResource(() => api.listParcels(query), key);
  // Later pages, kept only while the query that loaded them is the current one.
  const [more, setMore] = useState<{ key: string; items: Schema<'OperatorParcel'>[]; next?: string }>();
  const extra = more?.key === key ? more : undefined;
  const items = [...(first.data?.items ?? []), ...(extra?.items ?? [])];
  const next = extra ? extra.next : first.data?.nextCursor;
  const load = useAction();

  async function loadMore() {
    const page = await load.run(() => api.listParcels({ ...query, cursor: next }));
    if (page) setMore({ key, items: [...(extra?.items ?? []), ...page.items], next: page.nextCursor });
  }

  return (
    <Page title="Parcels">
      <Card>
        <Field
          label="Search"
          hint="AWB, order ID, name or phone on the label, member name, or shelf."
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => setQ(text.trim())}
          autoCapitalize="none"
        />
        <Button label="Search" variant="quiet" onPress={() => setQ(text.trim())} />
        <Choice
          label="Show"
          values={['IN_MAILROOM', 'UNMATCHED', 'ALL'] as const}
          value={filter}
          onChange={setFilter}
          names={FILTERS}
        />
      </Card>
      <ResourceState loading={first.loading && !first.data} error={first.error} retry={first.retry} />
      {!!first.data && !items.length && <Empty title="No parcels" detail="Nothing matches this search." />}
      {items.map(parcel => (
        <ParcelCard key={parcel.id} parcel={parcel} onPress={() => setOpen(parcel.id)} />
      ))}
      <Feedback error={load.error} />
      {!!next && <Button label="Load more" variant="quiet" onPress={loadMore} busy={load.busy} />}
      {!!open && (
        <ParcelSheet
          parcelId={open}
          onClose={() => {
            setOpen(undefined);
            first.retry();
          }}
        />
      )}
    </Page>
  );
}
