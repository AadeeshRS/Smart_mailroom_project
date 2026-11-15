import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { Schema } from '../../api/service';
import { useAction, useResource } from '../../hooks';
import { carrierName, parcelCode } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import { Body, Button, Card, Empty, Feedback, Heading, Muted, Notice, Page, ResourceState, date } from '../../ui';
import { CollectSheet } from './CollectSheet';

/** Parcels waiting for the member at the mailroom, and notifications they haven't read (Android in Expo Go gets
 * no pushes, so this is where those members see them). */
export function MemberHome() {
  const { api, user } = useSession();
  const ready = useResource(() => api.listMyParcels({ view: 'ready' }));
  const items = ready.data?.items ?? [];
  const inbox = useResource(() => api.listNotifications({}));
  const unread = inbox.data?.items.filter(n => !n.read) ?? [];
  const read = useAction();
  async function markRead() {
    if (await read.run(() => api.markNotificationsRead({}))) inbox.retry();
  }
  const [code, setCode] = useState<Schema<'MyCollection'>>();
  const [codeNotice, setCodeNotice] = useState('');
  const activeCode = useResource(() => api.getMyCollection({}), code?.id ?? '', !!code);
  useEffect(() => {
    if (!code || !activeCode.data) return;
    const current = activeCode.data.collection;
    if (!current || current.id !== code.id) {
      setCode(undefined);
      setCodeNotice(
        'This collection code is no longer active. Tap Collect now for a current code if parcels are still waiting.',
      );
    } else if (current.expiresAt !== code.expiresAt) {
      setCode(value => (value?.id === current.id ? { ...value, expiresAt: current.expiresAt } : value));
    }
  }, [code, activeCode.data]);
  // Close on the code's own countdown rather than waiting for the next server event (WS-10). A verified code gets a
  // new expiry through activeCode above, which restarts this timer.
  useEffect(() => {
    if (!code) return;
    const timer = setTimeout(
      () => {
        setCode(undefined);
        setCodeNotice('Your code expired. Tap Collect now for a new one.');
      },
      Math.max(0, Date.parse(code.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [code]);
  useEffect(() => {
    if (!ready.data) return;
    const waiting = ready.data.items;
    setCode(current => {
      if (!current) return current;
      const previous = new Set(current.parcels.map(parcel => parcel.id));
      if (waiting.length === previous.size && waiting.every(parcel => previous.has(parcel.id))) return current;
      return waiting.length ? { ...current, parcels: waiting } : undefined;
    });
  }, [ready.data]);
  const collect = useAction();
  async function collectNow() {
    setCodeNotice('');
    const result = await collect.run(() => api.collectNow({}));
    if (result) setCode(result);
  }
  async function cancel() {
    if (await collect.run(() => api.cancelCollection({}))) close();
  }
  function close() {
    setCode(undefined);
    ready.retry();
  }
  return (
    <Page title={`Hello, ${user?.name.split(' ')[0] ?? ''}`} subtitle="Parcels waiting for you at the mailroom.">
      <ResourceState loading={ready.loading && !ready.data} error={ready.error} retry={ready.retry} />
      {!!inbox.error && !ready.error && <ResourceState loading={false} error={inbox.error} retry={inbox.retry} />}
      {!!codeNotice && !code && !!items.length && <Notice>{codeNotice}</Notice>}
      {!!unread.length && (
        <Card>
          <Heading>New for you</Heading>
          {unread.map(n => (
            <View key={n.id}>
              <Body>{n.title}</Body>
              <Muted>{`${n.body} · ${date(n.createdAt)}`}</Muted>
            </View>
          ))}
          <Feedback error={read.error} />
          <Button label="Mark as read" variant="quiet" onPress={markRead} busy={read.busy} />
        </Card>
      )}
      {!!ready.data && !items.length && (
        <Empty
          title="Nothing waiting"
          detail="When a parcel you requested, or one with your phone number or email, arrives, it shows up here and you get a notification."
        />
      )}
      {!!items.length && (
        <Card>
          <Button label="Collect now" onPress={collectNow} busy={collect.busy} />
          <Muted>One code covers every parcel waiting for you.</Muted>
          {!code && <Feedback error={collect.error} />}
        </Card>
      )}
      {items.map(parcel => (
        <Card key={parcel.id}>
          <Heading>{parcelCode(parcel)}</Heading>
          <Muted>
            {carrierName(parcel.carrier)} · arrived {date(parcel.receivedAt)}
          </Muted>
          <Muted>At the mailroom, tap Collect now, then show your college ID.</Muted>
        </Card>
      ))}
      {!!code && (
        <CollectSheet
          code={code}
          busy={collect.busy}
          error={collect.error}
          onNew={collectNow}
          onCancel={cancel}
          onClose={close}
        />
      )}
    </Page>
  );
}
