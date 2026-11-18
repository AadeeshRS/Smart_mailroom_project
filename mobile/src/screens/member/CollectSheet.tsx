import encodeQr from 'qrcode-generator';
import { memo, useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import type { Schema } from '../../api/service';
import { collectQr, countdown, parcelCode } from '../../parcels';
import { Button, Card, Feedback, Heading, Muted, Notice, Page, styles } from '../../ui';

const CELL = 6;

/** Black on white with a quiet zone whatever the theme, so any scanner reads it. One View per run of dark
 * modules in a row; memo keeps the countdown's ticks from redrawing it. */
const Qr = memo(function Qr({ text }: { text: string }) {
  const qr = encodeQr(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const runs = [];
  for (let row = 0; row < size; row++)
    for (let start = 0; start < size; start++) {
      if (!qr.isDark(row, start)) continue;
      let end = start;
      while (end + 1 < size && qr.isDark(row, end + 1)) end++;
      runs.push(
        <View
          key={`${row}-${start}`}
          style={{
            position: 'absolute',
            top: row * CELL,
            left: start * CELL,
            width: (end - start + 1) * CELL,
            height: CELL,
            backgroundColor: '#000',
          }}
        />,
      );
      start = end;
    }
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="QR code for the mailroom to scan"
      style={{ alignSelf: 'center', padding: 4 * CELL, backgroundColor: '#fff', borderRadius: 8 }}
    >
      <View style={{ width: size * CELL, height: size * CELL }}>{runs}</View>
    </View>
  );
});

/** The member's Collect now code: a QR the operator scans, the digits to read out if their camera can't,
 * a countdown, a fresh code on demand, and the parcels it covers. */
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
      <Page modal title="Collect now" subtitle="Show this QR at the mailroom, with your college ID." back={onClose}>
        <Card>
          {left > 0 && <Qr text={collectQr(code)} />}
          <Text
            style={[styles.title, { fontSize: 44, lineHeight: 54, letterSpacing: 10, textAlign: 'center' }]}
            accessibilityLabel={`Your code ${[...code.otp].join(' ')}`}
          >
            {code.otp}
          </Text>
          {left > 0 ? (
            <Muted>
              Valid for {countdown(left)}. If the QR won’t scan, read out the code. A new code replaces this one.
            </Muted>
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
