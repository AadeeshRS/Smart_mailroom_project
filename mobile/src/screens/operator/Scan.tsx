import { useState } from 'react';
import type { Schema } from '../../api/service';
import { useAction } from '../../hooks';
import { Scanner } from '../../Scanner';
import { useSession } from '../../session/SessionProvider';
import { phoneUnused, type Draft } from '../../parcels';
import { Button, Card, Feedback, Field, Muted, Notice, Page, SuccessMark } from '../../ui';
import { IntakeForm } from './IntakeForm';
import { ParcelCard } from './ParcelCard';

/** Scan or type the code → lookup panel and label form → who it matched. */
export function ScanScreen() {
  const { api } = useSession();
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState<Schema<'Lookup'>>();
  const [saved, setSaved] = useState<{ parcel: Schema<'OperatorParcel'>; draft: Draft }>();
  const [shelf, setShelf] = useState(''); // kept between parcels: they usually go on the same shelf
  const find = useAction();

  async function look(value: string) {
    const result = await find.run(() => api.lookupParcel({ code: value.trim() }));
    if (result) setLookup(result);
  }
  function next() {
    setLookup(undefined);
    setSaved(undefined);
    setCode('');
  }

  if (saved) {
    const unmatched = !saved.parcel.recipient;
    return (
      <Page title="Parcel saved">
        <SuccessMark />
        <ParcelCard parcel={saved.parcel} />
        {unmatched && phoneUnused(saved.draft, saved.parcel) ? (
          <Notice>
            The phone wasn’t used for matching (masked or incomplete). Link this parcel with a request or manual assign.
          </Notice>
        ) : (
          unmatched && <Muted>It stays unmatched until it’s assigned in Parcels or a member requests it.</Muted>
        )}
        <Button label="Scan the next parcel" onPress={next} />
      </Page>
    );
  }
  if (lookup)
    return (
      <IntakeForm
        lookup={lookup}
        shelf={shelf}
        onSaved={(parcel, draft) => {
          setShelf(draft.shelf.trim());
          setSaved({ parcel, draft });
        }}
        onCancel={next}
      />
    );
  return (
    <Page title="Receive a parcel" subtitle="Scan the AWB or order-ID barcode, or type it.">
      <Card>
        <Button label="Scan barcode" onPress={() => setScanning(true)} />
        <Field
          label="AWB or order ID"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          onSubmitEditing={() => void look(code)}
        />
        <Feedback error={find.error} />
        <Button
          label="Look up"
          variant="quiet"
          onPress={() => void look(code)}
          busy={find.busy}
          disabled={!code.trim()}
        />
      </Card>
      <Scanner
        open={scanning}
        onClose={() => setScanning(false)}
        onScan={value => {
          setCode(value);
          void look(value);
        }}
      />
    </Page>
  );
}
