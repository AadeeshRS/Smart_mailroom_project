import { useEffect, useState } from 'react';
import { Modal, Text } from 'react-native';
import type { Schema } from '../../api/service';
import { countdown, parcelCode } from '../../parcels';
import { Button, Card, Feedback, Heading, Muted, Notice, Page, styles } from '../../ui';

/** The member's Collect now code: large, with a countdown, a fresh code on demand, and the parcels it covers. */
export function CollectSheet({
  code,
  busy,
  error,
  onNew,
  onCancel,
  onClose,
}: {
  code: Schema<'MyCollection'>;
  busy: boolean;
  error: string;
  onNew: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Date.parse(code.expiresAt) - now;
  const count = code.parcels.length;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Page modal title="Collect now" subtitle="Show this code at the mailroom, with your college ID." back={onClose}>
        <Card>
          <Text
            style={[styles.title, { fontSize: 44, lineHeight: 54, letterSpacing: 10, textAlign: 'center' }]}
            accessibilityLabel={`Your code ${[...code.otp].join(' ')}`}
          >
            {code.otp}
          </Text>
          {left > 0 ? (
            <Muted>Valid for {countdown(left)}. A new code replaces this one.</Muted>
          ) : (
            <Notice>This code has expired. Get a new one.</Notice>
          )}
          <Feedback error={error} />
          <Button label="New code" variant="quiet" onPress={onNew} busy={busy} />
          <Button label="Cancel code" variant="quiet" onPress={onCancel} busy={busy} />
        </Card>
        <Card>
          <Heading>{count === 1 ? 'For 1 parcel' : `For ${count} parcels`}</Heading>
          {code.parcels.map(parcel => (
            <Muted key={parcel.id}>{parcelCode(parcel)}</Muted>
          ))}
        </Card>
      </Page>
    </Modal>
  );
}
