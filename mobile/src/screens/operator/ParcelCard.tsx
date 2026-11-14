import { Pressable } from 'react-native';
import type { Schema } from '../../api/service';
import { carrierName, matchText, parcelCode } from '../../parcels';
import { Body, Card, Heading, Muted, Tag, date } from '../../ui';

/** A parcel as operators see it; tappable when `onPress` is given. */
export function ParcelCard({ parcel, onPress }: { parcel: Schema<'OperatorParcel'>; onPress?: () => void }) {
  const card = (
    <Card>
      <Heading>{parcelCode(parcel)}</Heading>
      <Muted>
        {carrierName(parcel.carrier)} · shelf {parcel.shelf} · {date(parcel.receivedAt)}
      </Muted>
      {!!parcel.labelName && <Body>Label: {parcel.labelName}</Body>}
      <Body>{matchText(parcel)}</Body>
      <Tag value={parcel.status !== 'IN_MAILROOM' ? parcel.status : (parcel.matchFlag ?? 'IN_MAILROOM')} />
    </Card>
  );
  if (!onPress) return card;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Parcel ${parcelCode(parcel)}`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      {card}
    </Pressable>
  );
}
