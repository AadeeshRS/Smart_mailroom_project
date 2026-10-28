import { useRouter } from 'expo-router';
import React from 'react';
import { useAction, useResource, useRuntime } from '../runtime';
import { Body, Button, Card, Feedback, Heading, Muted, ResourceState } from '../ui';
export function WriteRecoveryInbox() {
  const { writeRecovery, session } = useRuntime(); const action = useAction(); const router = useRouter();
  const resource = useResource(async () => writeRecovery && session ? writeRecovery.list(session.profile.id) : [], session?.profile.id);
  return <><ResourceState {...resource} /><Feedback error={action.error} />{resource.data?.map(record => <Card key={record.operation}><Heading>Recover saved write</Heading><Body>{record.operation}</Body><Muted>The original request and key are saved for this backend and account.</Muted><Button label={`Recover original ${record.operation}`} busy={action.busy} onPress={() => action.run(async () => { try { const result = await writeRecovery!.retry(session!.profile.id, record); router.push(record.operation === 'createOrder' ? `/order/${result.id}` : `/parcel/${result.id}`); } finally { resource.retry(); } })} /></Card>)}</>;
}
