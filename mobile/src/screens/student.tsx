import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import type { Schema } from '../api/service';
import { retryKey, useAction, useResource, useRuntime } from '../runtime';
import { Body, Button, Card, Choice, Empty, Feedback, Field, Heading, Muted, Notice, Page, ResourceState, Tag, date, styles } from '../ui';

import { PLATFORMS, CARRIERS } from '../api/identifiers';
export const platforms = PLATFORMS;
export const carriers = CARRIERS;
export function StudentHome() {
  const { api, session } = useRuntime(); const router = useRouter();
  const resource = useResource(async () => ({ orders: await api.listOrders({ limit: 100 }), parcels: await api.listParcels({ limit: 100 }), inbox: await api.listNotifications({ limit: 100 }) }));
  return <Page title={`Hello, ${session?.profile.name.split(' ')[0] ?? 'there'}.`} subtitle="Know what’s expected. See what’s ready.">
    <Card><Tag value="ORDER_FIRST" /><Heading>Expecting something?</Heading><Body>Register the merchant order ID. Add tracking whenever it becomes available.</Body><Button label="Register an expected order" onPress={() => router.push('/register')} /></Card>
    <ResourceState {...resource} />
    {resource.data && <><View style={styles.row}><Card><Heading>{resource.data.parcels.items.filter(p => p.collectionEligible).length} ready</Heading><Muted>Parcels to collect</Muted></Card><Card><Heading>{resource.data.inbox.items.filter(n => !n.readAt).length} unread</Heading><Muted>Inbox updates</Muted></Card></View><Heading>Ready for your next step</Heading>{resource.data.parcels.items.filter(p => p.status !== 'CLOSED').slice(0, 3).map(p => <ParcelCard key={p.id} parcel={p} />)}{!resource.data.parcels.items.some(p => p.status !== 'CLOSED') && <Empty title="Nothing to collect yet" detail="A validated match at mailroom intake will make a parcel appear here and in your inbox." />}<Button label="View all expected orders" variant="quiet" onPress={() => router.push('/student/orders')} /></>}
    <Muted>Counts show up to the latest 100 records. Each physical shipment has its own collection code.</Muted>
  </Page>;
}
export function RegisterScreen() {
  const { api, session } = useRuntime(); const router = useRouter(); const action = useAction();
  const registrationKey = useRef(retryKey());
  const [platform, setPlatform] = useState<Schema<'Platform'>>('AMAZON'); const [orderId, setOrderId] = useState(''); const [carrier, setCarrier] = useState<Schema<'Carrier'>>('DELHIVERY'); const [tracking, setTracking] = useState(''); const [help, setHelp] = useState<Schema<'Guide'>>();
  if (!session) return <Redirect href="/" />;
  if (session.profile.role !== 'STUDENT') return <Redirect href="/staff" />;
  return <Page title="Register an order" subtitle="Start with the purchase, not the shipping label." back={() => router.back()}>
    <Card><Choice label="Shopping platform" values={platforms} value={platform} onChange={value => { setPlatform(value); setHelp(undefined); }} /><Field label="Merchant order ID" value={orderId} onChangeText={setOrderId} autoCapitalize="characters" placeholder="e.g. AMZ-DEMO-1001" maxLength={100} hint="This is the merchant’s order reference, not the courier tracking/AWB number." /><Button label="Where do I find my order ID?" variant="quiet" busy={action.busy} onPress={() => action.run(async () => setHelp(await api.getGuide({ platform })))} />
    {help && <Notice>{help.steps.map((step, index) => `${index + 1}. ${step}`).join('\n\n')}{'\n\n'}{help.caution}</Notice>}</Card>
    <Card><Heading>Tracking reference · optional</Heading><Choice label="Carrier namespace" values={carriers} value={carrier} onChange={setCarrier} /><Field label="Tracking / AWB number" value={tracking} onChangeText={setTracking} maxLength={100} autoCapitalize="characters" hint="You can add this later. Select the carrier printed on the label. OTHER tracking references require staff review." /></Card>
    <Feedback error={action.error} /><Button label="Create expected order" busy={action.busy} onPress={() => action.run(async () => { const result = await api.createOrder({ idempotencyKey: registrationKey.current, platform, merchantOrderId: orderId, tracking: tracking.trim() ? [{ kind: 'TRACKING', namespace: carrier, value: tracking.trim() }] : [] }); router.replace(`/order/${result.id}`); })} />
  </Page>;
}
export function OrdersScreen() {
  const { api } = useRuntime(); const router = useRouter(); const [q, setQ] = useState(''); const [status, setStatus] = useState('ALL'); const [cursor, setCursor] = useState<string>();
  const resource = useResource(() => api.listOrders({ q, status: status === 'ALL' ? undefined : status as Schema<'OrderStatus'>, cursor }), `${q}|${status}|${cursor}`);
  return <Page title="Expected orders" subtitle="Matched means at least one shipment has arrived."><Button label="Register an expected order" onPress={() => router.push('/register')} /><Field label="Search your orders" value={q} onChangeText={value => { setQ(value); setCursor(undefined); }} /><Choice label="Order status" values={['ALL', 'PENDING', 'MATCHED', 'CANCELLED']} value={status} onChange={value => { setStatus(value); setCursor(undefined); }} /><ResourceState {...resource} />
    {!resource.loading && !resource.error && resource.data && <>{resource.data.items.length ? resource.data.items.map(order => <Card key={order.id}><View style={styles.spread}><Muted>{order.platform}</Muted><Tag value={order.status} /></View><Heading>{order.merchantOrderId}</Heading><Muted>{order.parcelIds.length} linked shipment(s) · {date(order.createdAt)}</Muted>{order.duplicateClaim && <Notice>Overlapping claim: staff review is required before collection.</Notice>}<Button label={`View order ${order.merchantOrderId}`} variant="quiet" onPress={() => router.push(`/order/${order.id}`)} /></Card>) : <Empty title="No expected orders here" detail="Register a purchase or adjust your search and filters." />}<Pagination cursor={cursor} next={resource.data.nextCursor} setCursor={setCursor} /></>}
  </Page>;
}
export function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { api, session } = useRuntime(); const router = useRouter(); const action = useAction();
  const [carrier, setCarrier] = useState<Schema<'Carrier'>>('DELHIVERY'); const [tracking, setTracking] = useState('');
  const resource = useResource(async () => { const order = await api.getOrder({ orderId: id }); return { order, parcels: await Promise.all(order.parcelIds.map(parcelId => api.getParcel({ parcelId }))) }; }, id);
  if (!session) return <Redirect href="/" />;
  return <Page title="Order details" back={() => router.back()}><ResourceState {...resource} />{resource.data && !resource.error && <>
    <Card><Muted>{resource.data.order.platform}</Muted><Heading>{resource.data.order.merchantOrderId}</Heading><Tag value={resource.data.order.status} /><Body>{resource.data.order.parcelIds.length} physical shipment(s) linked</Body><Muted>An order can ship in multiple parcels. Matched does not mean all shipments have arrived.</Muted>{resource.data.order.duplicateClaim && <Notice>Overlapping claim. Assigned parcels may be on hold until staff resolve the evidence.</Notice>}{resource.data.order.tracking.map((t, i) => <Body key={i}>{t.namespace} · {t.value}</Body>)}</Card>
    {resource.data.order.status !== 'CANCELLED' && <Card><Heading>Add tracking when available</Heading><Choice label="Carrier" values={carriers} value={carrier} onChange={setCarrier} /><Field label="New tracking / AWB number" value={tracking} onChangeText={setTracking} maxLength={100} /><Button label="Add tracking reference" busy={action.busy} onPress={() => action.run(async () => { await api.addTracking({ orderId: id, reference: { kind: 'TRACKING', namespace: carrier, value: tracking } }); setTracking(''); resource.retry(); })} /></Card>}
    <Heading>Shipments</Heading>{resource.data.parcels.length ? resource.data.parcels.map(p => <ParcelCard key={p.id} parcel={p} />) : <Empty title="No shipment received yet" detail="An unmatched parcel may be reviewed when you add a comparable tracking reference." />}
    {resource.data.order.status === 'PENDING' && !resource.data.order.parcelIds.length && <Button label="Cancel expected order" variant="danger" busy={action.busy} onPress={() => action.run(async () => { await api.cancelOrder({ orderId: id }); resource.retry(); })} />}
    <Feedback error={action.error} />
  </>}</Page>;
}
export function ParcelCard({ parcel }: { parcel: Schema<'Parcel'> }) {
  const router = useRouter();
  return <Card><View style={styles.spread}><Muted>{parcel.id}</Muted><Tag value={parcel.status} /></View><Heading>{parcel.description}</Heading><Body>Storage · {parcel.storageLocation}</Body>{parcel.hold !== 'NONE' && <Notice>Collection hold: {parcel.holdReason}</Notice>}<Muted>{parcel.collectionEligible ? 'Ready to request a collection code' : parcel.status === 'CLOSED' ? 'Collected · receipt retained' : parcel.matchExplanation}</Muted><Button label={`View parcel ${parcel.id}`} variant="quiet" onPress={() => router.push(`/parcel/${parcel.id}`)} /></Card>;
}
export function Pagination({ cursor, next, setCursor }: { cursor?: string; next?: string; setCursor: (value: string | undefined) => void }) {
  return <View style={styles.row}>{cursor && <Button label="First page" variant="quiet" onPress={() => setCursor(undefined)} />}{next && <Button label="Next page" variant="quiet" onPress={() => setCursor(next)} />}</View>;
}
export function ParcelsScreen() {
  const { api, session } = useRuntime(); const staff = session?.profile.role === 'STAFF';
  const [q, setQ] = useState(''); const [status, setStatus] = useState('ALL'); const [hold, setHold] = useState('ALL'); const [cursor, setCursor] = useState<string>();
  const resource = useResource(() => api.listParcels({ q, status: status === 'ALL' ? undefined : status as Schema<'ParcelStatus'>, hold: hold === 'ALL' ? undefined : hold as Schema<'Hold'>, cursor }), `${q}|${status}|${hold}|${cursor}`);
  return <Page title={staff ? 'Parcel register' : 'Your parcels'} subtitle="Search current parcels and retained collected history."><Field label="Search parcels" placeholder="ID, reference, description or storage" value={q} onChangeText={value => { setQ(value); setCursor(undefined); }} /><Choice label="Parcel status" values={['ALL', 'AWAITING_MATCH', 'AWAITING_COLLECTION', 'CLOSED']} value={status} onChange={value => { setStatus(value); setCursor(undefined); }} /><Choice label="Collection hold" values={['ALL', 'NONE', 'REVIEW', 'DISPUTE']} value={hold} onChange={value => { setHold(value); setCursor(undefined); }} /><ResourceState {...resource} />
    {!resource.loading && !resource.error && resource.data && <>{resource.data.items.length ? resource.data.items.map(p => <ParcelCard key={p.id} parcel={p} />) : <Empty title="No parcels found" detail={staff ? 'Register a physical intake, or adjust your filters.' : 'Your linked parcels will appear after a trustworthy match. Try changing the filters.'} />}<Pagination cursor={cursor} next={resource.data.nextCursor} setCursor={setCursor} /></>}
  </Page>;
}
export function InboxScreen() {
  const { api } = useRuntime(); const router = useRouter(); const action = useAction(); const [cursor, setCursor] = useState<string>();
  const resource = useResource(() => api.listNotifications({ cursor }), cursor);
  return <Page title="Your inbox" subtitle="Available in app. External delivery is simulated only."><ResourceState {...resource} /><Feedback error={action.error} />{!resource.loading && !resource.error && resource.data && <>{resource.data.items.length ? resource.data.items.map(n => <Card key={n.id}><View style={styles.spread}><Tag value={n.readAt ? 'READ' : 'UNREAD'} /><Muted>{date(n.createdAt)}</Muted></View><Heading>{n.title}</Heading><Body>{n.message}</Body><Muted>In-app: {n.inAppAvailable ? 'available' : 'unavailable'} · External: {n.externalDelivery.toLowerCase()} (simulated, nothing sent)</Muted>{!n.readAt && <Button label={`Mark ${n.id} as read`} variant="quiet" busy={action.busy} onPress={() => action.run(async () => { await api.readNotification({ notificationId: n.id }); resource.retry(); })} />}<Button label={`Open parcel ${n.parcelId}`} variant="quiet" onPress={() => router.push(`/parcel/${n.parcelId}`)} /></Card>) : <Empty title="You’re up to date" detail="An arrival notification appears after a parcel is safely linked to your order." />}<Pagination cursor={cursor} next={resource.data.nextCursor} setCursor={setCursor} /></>}</Page>;
}
