import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';
import { useResource } from '../../hooks';
import type { Schema } from '../../api/service';
import { memberLine } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import { Body, Card, Empty, Heading, Muted, Page, ResourceState } from '../../ui';
import { HandoverSheet } from './HandoverSheet';

type Code = Schema<'OperatorCollection'>;
type Giveaway = { items: Code[]; loaded: boolean; error: string; retry: () => void; open: (code: Code) => void };
const Context = createContext<Giveaway | null>(null);

/** A new collection pops up while staff work; live snapshots also update an already-open handover. */
export function GiveawayProvider({ children }: { children: React.ReactNode }) {
  const { api, user } = useSession();
  const staff = user?.role === 'OPERATOR' || user?.role === 'ADMIN';
  const [sheet, setSheet] = useState<Code>();
  const queue = useResource(() => api.listCollections({}), '', staff);
  const items = queue.data?.items ?? [];
  const seen = useRef({ owner: user?.id, ids: new Set<string>() });

  useEffect(() => {
    if (seen.current.owner !== user?.id) {
      seen.current = { owner: user?.id, ids: new Set() };
      setSheet(undefined);
    }
    const codes = queue.data?.items ?? [];
    const active = new Set(codes.map(code => code.id));
    seen.current.ids.forEach(id => {
      if (!active.has(id)) seen.current.ids.delete(id);
    });
    const fresh = codes.find(code => !seen.current.ids.has(code.id));
    if (fresh && !sheet) {
      seen.current.ids.add(fresh.id);
      setSheet(fresh);
    }
  }, [queue.data, user?.id, sheet]);
  const open = (code: Code) => {
    seen.current.ids.add(code.id);
    setSheet(code);
  };

  return (
    <Context.Provider value={{ items, loaded: !!queue.data, error: queue.error, retry: queue.retry, open }}>
      {children}
      {!!sheet && (
        <HandoverSheet
          key={sheet.id}
          initial={sheet}
          latest={queue.data?.items.find(code => code.id === sheet.id)}
          unavailable={!!queue.data && !queue.data.items.some(code => code.id === sheet.id)}
          onClose={() => {
            setSheet(undefined);
            queue.retry();
          }}
        />
      )}
    </Context.Provider>
  );
}

/** Members who tapped Collect now; tap one to verify their code and hand over. */
export function GiveawayScreen() {
  const giveaway = useContext(Context)!;
  return (
    <Page title="Giveaway" subtitle="Members who tapped Collect now. New ones pop up by themselves.">
      <ResourceState loading={!giveaway.loaded && !giveaway.error} error={giveaway.error} retry={giveaway.retry} />
      {giveaway.loaded && !giveaway.items.length && (
        <Empty title="Nobody waiting" detail="When a member taps Collect now, they show up here." />
      )}
      {giveaway.items.map(code => (
        <Pressable
          key={code.id}
          accessibilityRole="button"
          accessibilityLabel={`Hand over to ${code.member.name}`}
          onPress={() => giveaway.open(code)}
          style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
        >
          <Card>
            <Heading>{code.member.name}</Heading>
            <Muted>{memberLine(code.member)}</Muted>
            <Body>
              {code.parcels.length === 1 ? '1 parcel' : `${code.parcels.length} parcels`} ·{' '}
              {code.status === 'VERIFIED' ? 'code verified' : 'waiting for the code'}
            </Body>
          </Card>
        </Pressable>
      ))}
    </Page>
  );
}
