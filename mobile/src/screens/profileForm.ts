import type { Schema } from '../api/service';

export type ProfileForm = {
  memberType: 'STUDENT' | 'STAFF';
  idNumber: string;
  phone: string;
  altPhone: string;
  personalEmail: string;
  hostelId: string;
  roomNumber: string;
};
export const NO_HOSTEL = 'NONE';

export const formFrom = (user?: Schema<'User'>): ProfileForm => ({
  memberType: user?.memberType ?? 'STUDENT',
  idNumber: user?.idNumber ?? '',
  phone: user?.phone ?? '',
  altPhone: user?.altPhone ?? '',
  personalEmail: user?.personalEmail ?? '',
  hostelId: user?.hostelId ?? NO_HOSTEL,
  roomNumber: user?.roomNumber ?? '',
});

/** Only the fields that changed, ready for PATCH /me. Blank optional fields are cleared. */
export function changes(form: ProfileForm, before: ProfileForm, member: boolean) {
  const out: Record<string, string | null> = {};
  const keys: (keyof ProfileForm)[] = member
    ? ['memberType', 'idNumber', 'phone', 'altPhone', 'personalEmail', 'hostelId', 'roomNumber']
    : ['phone'];
  for (const key of keys) {
    const value = form[key].trim();
    if (value === before[key]) continue;
    if (key === 'hostelId') out.hostelId = value === NO_HOSTEL ? null : value;
    else if (value || !['idNumber', 'phone', 'memberType'].includes(key)) out[key] = value || null;
  }
  return out as Schema<'UpdateMeInput'>;
}

/** The registration body: the form without blank optional fields. */
export function registration(form: ProfileForm) {
  const optional = (value: string) => value.trim() || undefined;
  return {
    memberType: form.memberType,
    idNumber: form.idNumber.trim(),
    phone: form.phone.trim(),
    altPhone: optional(form.altPhone),
    personalEmail: optional(form.personalEmail),
    hostelId: form.hostelId === NO_HOSTEL ? undefined : form.hostelId,
    roomNumber: optional(form.roomNumber),
  };
}
