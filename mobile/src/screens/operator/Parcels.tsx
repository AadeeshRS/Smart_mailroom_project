import { useState } from 'react';
import type { Schema } from '../../api/service';
import { useAction, useResource } from '../../hooks';
import { useSession } from '../../session/SessionProvider';
import { Button, Card, Choice, Empty, Field, Page, ResourceState } from '../../ui';
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
  const [paging, setPaging] = useState({ key, size: 20 });
  const size = paging.key === key ? paging.size : 20;
  // One live request (WS-12): Load more grows it 20 rows at a time, up to the API's 100, so each refresh is a
  // single read and new arrivals can't push a row into a gap between pages.
  // ponytail: past 100 rows, later pages load on demand and don't refresh live; a search narrows the list.
  const first = useResource(() => api.listParcels({ ...query, limit: size }), key);
  const [more, setMore] = useState<{ key: string; items: Schema<'OperatorParcel'>[]; next?: string }>();
  const extra = more?.key === key && size === 100 ? more : undefined;
  const firstItems = first.data?.items ?? [];
  const shown = new Set(firstItems.map(parcel => parcel.id));
  const items = [...firstItems, ...(extra?.items.filter(parcel => !shown.has(parcel.id)) ?? [])];
  const next = extra ? extra.next : first.data?.nextCursor;
  const load = useAction();
  async function loadMore() {
    if (size < 100) {
      setPaging({ key, size: Math.min(100, size + 20) });
      return first.retry();
    }
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
      {!!next && (
        <Button label="Load more" variant="quiet" onPress={() => void loadMore()} busy={first.loading || load.busy} />
      )}
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
