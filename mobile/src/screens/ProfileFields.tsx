import { useResource } from '../hooks';
import { useSession } from '../session/SessionProvider';
import { Choice, Field, Muted } from '../ui';
import { NO_HOSTEL, type ProfileForm } from './profileForm';

/** The profile fields every member fills in (plan W3). Operators and admins only see the phone. */
export function ProfileFields({
  form,
  onChange,
  member,
}: {
  form: ProfileForm;
  onChange: (form: ProfileForm) => void;
  member: boolean;
}) {
  const { api } = useSession();
  const hostels = useResource(() => api.listHostels({}));
  const set = (field: keyof ProfileForm) => (value: string) => onChange({ ...form, [field]: value });
  const active = (hostels.data?.items ?? []).filter(h => h.active || h.id === form.hostelId);
  const phone = { keyboardType: 'phone-pad', autoComplete: 'tel', textContentType: 'telephoneNumber' } as const;
  const email = { keyboardType: 'email-address', autoCapitalize: 'none', autoComplete: 'email' } as const;
  if (!member) return <Field label="Phone" value={form.phone} onChangeText={set('phone')} {...phone} />;
  return (
    <>
      <Choice
        label="I am"
        values={['STUDENT', 'STAFF'] as const}
        value={form.memberType}
        onChange={set('memberType')}
        names={{ STUDENT: 'A student', STAFF: 'College staff' }}
      />
      <Field
        label={form.memberType === 'STUDENT' ? 'Enrollment number' : 'Staff ID'}
        value={form.idNumber}
        onChangeText={set('idNumber')}
        autoCapitalize="characters"
      />
      <Field
        label="Phone"
        hint="The number couriers print on your parcels."
        value={form.phone}
        onChangeText={set('phone')}
        {...phone}
      />
      <Field label="Alternate phone (optional)" value={form.altPhone} onChangeText={set('altPhone')} {...phone} />
      <Field
        label="Personal email (optional)"
        hint="If you order with a personal email, parcels addressed to it can find you too."
        value={form.personalEmail}
        onChangeText={set('personalEmail')}
        {...email}
      />
      {hostels.loading ? (
        <Muted>Loading hostels…</Muted>
      ) : (
        <Choice
          label="Hostel"
          values={[NO_HOSTEL, ...active.map(h => h.id)]}
          value={form.hostelId}
          onChange={set('hostelId')}
          names={{ [NO_HOSTEL]: 'Not in a hostel', ...Object.fromEntries(active.map(h => [h.id, h.name])) }}
        />
      )}
      <Field label="Room (optional)" value={form.roomNumber} onChangeText={set('roomNumber')} />
    </>
  );
}
