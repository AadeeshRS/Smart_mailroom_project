import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import type { PendingWrite, RecoveryProtection } from '../api/writeRecovery';
import { ServiceError } from '../api/service';
import { useAction, useResource, useRuntime } from '../runtime';
import { Body, Button, Card, Check, Feedback, Heading, Muted, Notice, ResourceState, styles } from '../ui';
function OriginalWrite({ record, refresh }: { record: PendingWrite; refresh: () => void }) {
  const { api, writeRecovery, session } = useRuntime(); const action = useAction(); const router = useRouter();
  const [protection, setProtection] = useState<RecoveryProtection>();
  const [inspection, setInspection] = useState<unknown>(); const [nextCursor, setNextCursor] = useState<string>(); const [reviewed, setReviewed] = useState(false);
  const [missingParcel, setMissingParcel] = useState(false);
  useEffect(() => {
    let active = true;
    const check = () => { void writeRecovery!.protection(record).then(value => { if (active) setProtection(value); }).catch(() => { if (active) setProtection(undefined); }); };
    check(); const timer = setInterval(check, 1000); return () => { active = false; clearInterval(timer); };
  }, [writeRecovery, record]);
  const stopped = protection === 'EXPIRED' || protection === 'RESET';
  async function inspect(cursor?: string) {
    const request = record.request;
    if ('merchantOrderId' in request) {
      const result = await api.listOrders({ q: request.merchantOrderId, limit: 100, cursor }); setInspection(result); setNextCursor(result.nextCursor);
    } else if ('physicalReference' in request) {
      const result = await api.listParcels({ q: request.physicalReference, limit: 100, cursor }); setInspection(result); setNextCursor(result.nextCursor);
    } else {
      try { setInspection(await api.getStaffParcel({ parcelId: request.parcelId })); setMissingParcel(false); }
      catch (error) { if (!(error instanceof ServiceError) || error.code !== 'NOT_FOUND') throw error; setInspection({ parcelId: request.parcelId, currentRecord: 'NOT_FOUND', note: 'Inspect the retained original; absence does not prove it never committed before a reset.' }); setMissingParcel(true); }
      setNextCursor(undefined);
    }
    setReviewed(false);
  }
  return <Card><Heading>{protection === 'REVIEWED' ? 'Original write retained for investigation' : stopped ? 'Recovery protection expired' : 'Recover saved write'}</Heading>
    <Body>{record.operation}</Body><Muted>Original request saved {record.createdAt}. Key: {record.request.idempotencyKey}</Muted>
    <Text selectable style={styles.muted}>{JSON.stringify(record.request, null, 2)}</Text>
    {protection === 'RECOVERABLE' && <><Muted>The original request and key remain protected for 24 hours from the first attempt.</Muted><Button label={`Recover original ${record.operation}`} busy={action.busy} onPress={() => action.run(async () => { try { const result = await writeRecovery!.retry(session!.profile.id, record); router.push(record.operation === 'createOrder' ? `/order/${result.id}` : `/parcel/${result.id}`); } finally { refresh(); } })} /></>}
    {stopped && <Notice danger>{protection === 'RESET' ? 'A development reset was attempted. Pre-reset originals cannot be replayed.' : 'The ordinary 24-hour replay window has ended, or its timestamp cannot be trusted.'} This original will not be posted. Inspect existing records before explicitly reviewing any new operation. An empty search does not prove the original never committed.</Notice>}
    {protection !== 'RECOVERABLE' && <><Button label={`Inspect existing records for ${record.operation}`} variant="quiet" busy={action.busy} onPress={() => action.run(() => inspect())} />
      {inspection !== undefined && <><Muted>Read-only current server records. Compare identifiers and physical references.</Muted><Text selectable style={styles.muted}>{JSON.stringify(inspection, null, 2)}</Text>{nextCursor && <Button label="Inspect next page of records" variant="quiet" busy={action.busy} onPress={() => action.run(() => inspect(nextCursor))} />}</>}
    </>}
    {stopped && inspection !== undefined && <><Check label="I inspected the original request and current records and will explicitly review a separate new operation" checked={reviewed} onChange={setReviewed} /><Button label={`Retain original and review new ${record.operation}`} disabled={!reviewed} busy={action.busy} onPress={() => action.run(async () => { await writeRecovery!.reviewForNewOperation(session!.profile.id, record); refresh(); router.push(record.operation === 'createOrder' ? '/register' : record.operation === 'intakeParcel' ? '/staff/intake' : missingParcel ? '/staff/parcels' : `/review/${'parcelId' in record.request ? record.request.parcelId : ''}`); })} /></>}
    <Feedback error={action.error} />
  </Card>;
}
export function WriteRecoveryInbox() {
  const { writeRecovery, session } = useRuntime();
  const resource = useResource(async () => writeRecovery && session ? writeRecovery.list(session.profile.id) : [], session?.profile.id);
  return <><ResourceState {...resource} />{resource.data?.map(record => <OriginalWrite key={record.operation + ':' + record.request.idempotencyKey} record={record} refresh={resource.retry} />)}</>;
}
