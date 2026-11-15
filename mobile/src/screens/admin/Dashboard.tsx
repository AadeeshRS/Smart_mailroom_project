import { useState } from 'react';
import { Text, View } from 'react-native';
import type { Schema } from '../../api/service';
import { useAction, useResource } from '../../hooks';
import { useSession } from '../../session/SessionProvider';
import { Button, Card, Empty, Feedback, Heading, Muted, Page, ResourceState, date, styles } from '../../ui';
import { ParcelCard } from '../operator/ParcelCard';
import { AdminHostels } from './Hostels';
import { AdminUsers } from './Users';

/** Midnight on this phone, so "today" is the mailroom's day without a server time zone. */
function todayStart() {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return midnight.toISOString();
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <View
      style={[styles.card, { flexBasis: '45%', flexGrow: 1, gap: 4 }]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={styles.title}>{value}</Text>
      <Muted>{label}</Muted>
    </View>
  );
}

/** W9: today's counts, what's waiting too long (remind or return it), and the way to users and hostels. */
export function AdminDashboard() {
  const { api } = useSession();
  const stats = useResource(() => api.getStats({ dayStart: todayStart() }));
  const aging = useResource(() => api.listAging({}));
  const [sheet, setSheet] = useState<'users' | 'hostels'>();
  const s = stats.data;
  const items = aging.data?.items ?? [];
  return (
    <Page title="Dashboard" subtitle="Today at the mailroom.">
      <ResourceState loading={stats.loading && !s} error={stats.error} retry={stats.retry} />
      {!!s && (
        <>
          <View style={[styles.row, { alignItems: 'stretch' }]}>
            <Tile label="Received today" value={s.received} />
            <Tile label="Collected today" value={s.collected} />
            <Tile label="Waiting now" value={s.waiting} />
            <Tile label={`Waiting over ${s.tooLongDays} days`} value={s.waitingByAge.overLimit} />
            <Tile label="Unmatched" value={s.unmatched} />
            <Tile label="Open requests" value={s.openRequests} />
          </View>
          <Muted>
            {`Waiting by age: ${s.waitingByAge.underThreeDays} under 3 days, ${s.waitingByAge.upToLimit} from 3 to ` +
              `${s.tooLongDays} days, ${s.waitingByAge.overLimit} longer.`}
          </Muted>
        </>
      )}
      <Card>
        <Button label="Users" variant="quiet" onPress={() => setSheet('users')} />
        <Button label="Hostels" variant="quiet" onPress={() => setSheet('hostels')} />
      </Card>
      <Heading>{`Waiting over ${aging.data?.olderThanDays ?? s?.tooLongDays ?? 7} days`}</Heading>
      <ResourceState loading={aging.loading && !aging.data} error={aging.error} retry={aging.retry} />
      {!!aging.data && !items.length && <Empty title="Nothing waiting too long" detail="Every parcel is recent." />}
      {items.map(item => (
        <Waiting key={item.parcel.id} item={item} />
      ))}
      {sheet === 'users' && <AdminUsers onClose={() => setSheet(undefined)} />}
      {sheet === 'hostels' && <AdminHostels onClose={() => setSheet(undefined)} />}
    </Page>
  );
}

/** Its writes need no re-read here: a successful write refreshes the open screens (api/http.ts). */
function Waiting({ item }: { item: Schema<'AgingList'>['items'][number] }) {
  const { api } = useSession();
  const action = useAction();
  const [confirm, setConfirm] = useState(false);
  const { parcel } = item;
  const parcelId = parcel.id;
  const member = parcel.recipient;
  async function remind() {
    await action.run(() => api.remindParcel({ parcelId }));
  }
  async function returnIt() {
    if (!confirm) return setConfirm(true);
    await action.run(() => api.returnParcel({ parcelId }));
  }
  return (
    <View style={{ gap: 8 }}>
      <ParcelCard parcel={parcel} />
      <Card>
        <Muted>
          {`Waiting ${item.daysWaiting} days · ` +
            (item.lastRemindedAt ? `member last told ${date(item.lastRemindedAt)}` : 'no member linked yet')}
        </Muted>
        {!!member && <Muted>{[member.phone, member.email].filter(Boolean).join(' · ')}</Muted>}
        <Feedback error={action.error} />
        {!!member && <Button label="Send reminder" variant="quiet" onPress={remind} busy={action.busy} />}
        <Button
          label={confirm ? 'Tap again to mark returned' : 'Mark returned to sender'}
          variant={confirm ? 'danger' : 'quiet'}
          onPress={returnIt}
          busy={action.busy}
        />
      </Card>
    </View>
  );
}
