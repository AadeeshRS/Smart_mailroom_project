import { useState } from 'react';
import { Pressable } from 'react-native';
import { ServiceError, type Schema } from '../../api/service';
import { useAction, useResource } from '../../hooks';
import { memberLine, readCollectQr } from '../../parcels';
import { Scanner } from '../../Scanner';
import { useSession } from '../../session/SessionProvider';
import { Body, Button, Card, Empty, Feedback, Heading, Muted, Page, ResourceState } from '../../ui';
import { HandoverSheet } from './HandoverSheet';

type Code = Schema<'OperatorCollection'>;

/** Members who tapped Collect now. A new code only joins this list; nothing pops up over what the operator is
 * doing. Scanning the member's QR finds and verifies their code in one step; tapping a name lets the operator
 * type it instead. */
export function GiveawayScreen() {
  const { api } = useSession();
  const queue = useResource(() => api.listCollections({}));
  const items = queue.data?.items ?? [];
  // `list` is the queue as the sheet opened: only a later read can say the code is gone, since a code just
  // verified by QR may not be in that one yet.
  const [sheet, setSheet] = useState<{ code: Code; list: typeof queue.data }>();
  const [scanning, setScanning] = useState(false);
  const scan = useAction();
  const open = (code: Code) => setSheet({ code, list: queue.data });

  async function verifyQr(text: string) {
    const qr = readCollectQr(text);
    const listed = items.find(code => code.id === qr?.collectionId);
    if (listed?.status === 'VERIFIED') return open(listed); // scanned again after closing its sheet
    const result = await scan.run(() => {
      if (!qr) throw new ServiceError('VALIDATION', 'That isn’t a Collect now QR. Scan the one on the member’s phone.');
      return api.verifyCollection(qr);
    });
    if (result) open(result);
  }

  const latest = items.find(code => code.id === sheet?.code.id);
  return (
    <Page title="Giveaway" subtitle="Scan the member’s QR, or tap their name and type their code.">
      <Card>
        <Button label="Scan member’s QR" onPress={() => setScanning(true)} busy={scan.busy} />
        <Feedback error={scan.error} />
      </Card>
      <ResourceState loading={!queue.data && !queue.error} error={queue.error} retry={queue.retry} />
      {!!queue.data && !items.length && (
        <Empty title="Nobody waiting" detail="When a member taps Collect now, they show up here." />
      )}
      {items.map(code => (
        <Pressable
          key={code.id}
          accessibilityRole="button"
          accessibilityLabel={`Hand over to ${code.member.name}`}
          onPress={() => open(code)}
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
      <Scanner
        open={scanning}
        title="Scan the member’s QR"
        notice="Point the camera at the QR on the member’s Collect now screen. It checks their code by itself."
        onClose={() => setScanning(false)}
        onScan={text => void verifyQr(text)}
      />
      {!!sheet && (
        <HandoverSheet
          key={sheet.code.id}
          initial={sheet.code}
          latest={latest}
          unavailable={!!queue.data && queue.data !== sheet.list && !latest}
          onClose={() => {
            setSheet(undefined);
            queue.retry();
          }}
        />
      )}
    </Page>
  );
}
