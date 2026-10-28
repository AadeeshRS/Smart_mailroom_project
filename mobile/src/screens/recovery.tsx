import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { confirmWithRecovery } from '../confirmationRecovery';
import { useAction, useResource, useRuntime } from '../runtime';
import { Body, Button, Card, Empty, Feedback, Heading, Muted, Notice, Page, ResourceState } from '../ui';

export function RecoveryInbox() {
  const { session, recovery } = useRuntime(); const router = useRouter();
  const resource = useResource(() => recovery.list(session!.profile.id), session?.profile.id);
  return <><ResourceState {...resource} />{resource.data?.filter(record => record.phase !== 'COMMITTED').map(record => <Card key={record.request.parcelId}><Heading>Recover handover outcome</Heading><Body>{record.request.parcelId} · {record.phase.toLowerCase()}</Body><Muted>The original request and retry key are saved for this staff account. A retry checks for the original receipt even after verification expires.</Muted><Button label={`Recover confirmation ${record.request.parcelId}`} onPress={() => router.push(`/recover/${record.request.parcelId}`)} /></Card>)}</>;
}
export function RecoveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { api, session, recovery } = useRuntime(); const router = useRouter(); const action = useAction();
  const resource = useResource(() => recovery.get(session!.profile.id, id), id);
  if (!session) return <Redirect href="/" />;
  if (session.profile.role !== 'STAFF') return <Redirect href="/student" />;
  const record = resource.data;
  return <Page title="Recover handover outcome" subtitle="Recovery retries the saved operation. It does not authorize a new handover." back={() => router.replace('/staff')}>
    <ResourceState {...resource} /><Feedback error={action.error} />
    {record ? <Card><Heading>{record.request.parcelId}</Heading><Body>Saved request · {record.phase.toLowerCase()}</Body><Muted>Saved {new Date(record.createdAt).toLocaleString()}. This record belongs to {session.profile.name}.</Muted>
      {record.receiptId ? <Button label="Open recovered receipt" onPress={() => router.replace(`/receipt/${record.receiptId}`)} /> : <><Notice>Use the original request and key even if verification has expired. A committed result returns its retained receipt; an uncommitted expired authorization will be rejected.</Notice><Button label="Retry original confirmation" busy={action.busy} onPress={() => action.run(async () => { try { const result = await confirmWithRecovery(recovery, api, session.profile.id, record.request); router.replace(`/receipt/${result.receipt.id}`); } finally { resource.retry(); } })} /></>}
      <Button label="Inspect parcel and retained receipt" variant="quiet" onPress={() => router.push(`/parcel/${id}`)} />
      {record.phase === 'REJECTED' && <Button label="Start verification after definitive rejection" variant="quiet" onPress={() => action.run(async () => { await recovery.clearRejected(session.profile.id, id); router.replace(`/verify/${id}`); })} />}
    </Card> : !resource.loading && !resource.error ? <Empty title="No recovery request for this account" detail="Return to the parcel and verify its current credential before a fresh handover." /> : null}
  </Page>;
}
