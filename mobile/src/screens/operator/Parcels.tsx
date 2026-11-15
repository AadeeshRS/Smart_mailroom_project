import { useState } from 'react';
import type { Schema } from '../../api/service';
import { useResource } from '../../hooks';
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
  const [paging, setPaging] = useState({ key, count: 1 });
  const count = paging.key === key ? paging.count : 1;
  // Refresh loaded pages together so later pages cannot retain stale rows or duplicate a moved row.
  const first = useResource(async () => {
    const items: Schema<'OperatorParcel'>[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < count; page++) {
      const result = await api.listParcels({ ...query, ...(cursor ? { cursor } : {}) });
      items.push(...result.items);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return { items, nextCursor: cursor };
  }, key);
  const items = first.data?.items ?? [];
  const next = first.data?.nextCursor;
  function loadMore() {
    setPaging({ key, count: count + 1 });
    first.retry();
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
      {!!next && <Button label="Load more" variant="quiet" onPress={loadMore} busy={first.loading} />}
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
