import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Pressable } from 'react-native';
import type { Schema } from '../../api/service';
import { memberLine } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import { Body, Card, Empty, Heading, Muted, Page, ResourceState } from '../../ui';
import { HandoverSheet } from './HandoverSheet';

type Code = Schema<'OperatorCollection'>;
type Giveaway = { items: Code[]; loaded: boolean; open: (code: Code) => void };
const Context = createContext<Giveaway | null>(null);

/** The giveaway queue for operators and admins, checked every 5 s while the app is in the foreground (plan §4.10).
 * A code not seen before pops up the handover sheet. ponytail: polling; server-sent events beyond ~20 operators. */
export function GiveawayProvider({ children }: { children: React.ReactNode }) {
  const { api, user, handleError } = useSession();
  const staff = user?.role === 'OPERATOR' || user?.role === 'ADMIN';
  const [items, setItems] = useState<Code[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sheet, setSheet] = useState<Code>();
  const [revision, setRevision] = useState(0);
  const seen = useRef(new Set<string>());
  const onError = useRef(handleError);
  onError.current = handleError;

  useEffect(() => {
    if (!staff) return;
    let alive = true;
    async function poll() {
      if (AppState.currentState !== 'active') return;
      try {
        const { items: codes } = await api.listCollections({});
        if (!alive) return;
        const fresh = codes.find(code => !seen.current.has(code.id));
        codes.forEach(code => seen.current.add(code.id));
        setItems(codes);
        setLoaded(true);
        if (fresh) setSheet(current => current ?? fresh);
      } catch (error) {
        onError.current(error); // signs out on an expired session; otherwise the next check retries
      }
    }
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, staff, revision]);

  return (
    <Context.Provider value={{ items, loaded, open: setSheet }}>
      {children}
      {!!sheet && (
        <HandoverSheet
          key={sheet.id}
          initial={sheet}
          onClose={() => {
            setSheet(undefined);
            setRevision(value => value + 1);
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
      <ResourceState loading={!giveaway.loaded} error="" retry={() => undefined} />
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
