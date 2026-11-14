import { useState } from 'react';
import { Modal, View } from 'react-native';
import type { Schema } from '../../api/service';
import { useAction } from '../../hooks';
import { carrierName, memberLine, parcelCode } from '../../parcels';
import { useSession } from '../../session/SessionProvider';
import {
  Body,
  Button,
  Card,
  Check,
  Empty,
  Feedback,
  Field,
  Heading,
  Muted,
  Notice,
  Page,
  SuccessMark,
  date,
  styles,
} from '../../ui';

/** One member's handover: their parcels with the label name next to theirs, the code check, then the parcels
 * the operator ticks. A label name that doesn't match needs the ID card checked (plan 5.5). */
export function HandoverSheet({ initial, onClose }: { initial: Schema<'OperatorCollection'>; onClose: () => void }) {
  const { api } = useSession();
  const [code, setCode] = useState(initial);
  const [otp, setOtp] = useState('');
  const [ticked, setTicked] = useState<string[]>([]);
  const [idChecked, setIdChecked] = useState(false);
  const [done, setDone] = useState(false);
  const action = useAction();
  const { member } = code;
  const verified = code.status === 'VERIFIED';
  const mismatch = code.parcels.some(p => ticked.includes(p.id) && !p.nameMatches);
  const tick = (id: string) => (on: boolean) => setTicked(on ? [...ticked, id] : ticked.filter(t => t !== id));

  async function verify() {
    const result = await action.run(() => api.verifyCollection({ collectionId: code.id, otp: otp.trim() }));
    if (result) setCode(result);
  }
  async function handOver() {
    const result = await action.run(() =>
      api.completeCollection({ collectionId: code.id, parcelIds: ticked, idChecked: mismatch && idChecked }),
    );
    if (result) setDone(true);
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Page modal title={member.name} subtitle={memberLine(member)} back={onClose}>
        {done ? (
          <>
            <SuccessMark label="Handed over" />
            <Body>{`Handed over to ${member.name}.`}</Body>
            <Button label="Done" onPress={onClose} />
          </>
        ) : (
          <>
            {!code.parcels.length && <Empty title="Nothing waiting" detail="No parcels are waiting for this member." />}
            {code.parcels.map(parcel => (
              <Card key={parcel.id}>
                <Heading>{parcelCode(parcel)}</Heading>
                <Muted>
                  {carrierName(parcel.carrier)} · shelf {parcel.shelf} · {date(parcel.receivedAt)}
                </Muted>
                <View style={styles.spread}>
                  <View style={{ flex: 1 }}>
                    <Muted>On the label</Muted>
                    <Body>{parcel.labelName ?? 'No name'}</Body>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Muted>Member</Muted>
                    <Body>{[member.name, member.idNumber].filter(Boolean).join(' · ')}</Body>
                  </View>
                </View>
                {!parcel.nameMatches && <Muted>The label name doesn’t match the member.</Muted>}
                {verified && (
                  <Check
                    label={`Handed over ${parcelCode(parcel)}`}
                    checked={ticked.includes(parcel.id)}
                    onChange={tick(parcel.id)}
                  />
                )}
              </Card>
            ))}
            <Card>
              {verified ? (
                <>
                  <Muted>Code verified. Tick the parcels you hand over; the rest stay in the mailroom.</Muted>
                  {mismatch && (
                    <>
                      <Notice danger>
                        {`A label name doesn’t match ${member.name}. Check their college ID card before handing it over.`}
                      </Notice>
                      <Check label="Checked ID card" checked={idChecked} onChange={setIdChecked} />
                    </>
                  )}
                  <Feedback error={action.error} />
                  <Button
                    label={`Hand over ${ticked.length} parcel${ticked.length === 1 ? '' : 's'}`}
                    onPress={handOver}
                    busy={action.busy}
                    disabled={!ticked.length || (mismatch && !idChecked)}
                  />
                </>
              ) : (
                <>
                  <Field
                    label="Code from the member"
                    hint="The 6 digits on their Collect now screen. 5 wrong tries cancel it."
                    value={otp}
                    onChangeText={setOtp}
                    keyboardType="number-pad"
                    onSubmitEditing={verify}
                  />
                  <Feedback error={action.error} />
                  <Button
                    label="Verify code"
                    onPress={verify}
                    busy={action.busy}
                    disabled={!/^\d{6}$/.test(otp.trim())}
                  />
                </>
              )}
            </Card>
          </>
        )}
      </Page>
    </Modal>
  );
}
