import { expect, it } from 'vitest';
import { NO_HOSTEL, changes, formFrom, registration } from '../src/screens/profileForm';

const user = {
  id: 'usr_1',
  role: 'MEMBER',
  email: 'asha@college.example',
  name: 'Asha',
  active: true,
  emailVerified: true,
  memberType: 'STUDENT',
  idNumber: '23CS1001',
  phone: '+919876543210',
  altPhone: '+919123456789',
  personalEmail: null,
  hostelId: 'hst_1',
  hostelName: 'Ganga',
  roomNumber: 'B-214',
  createdAt: '2026-11-14T00:00:00.000Z',
} as const;

it('sends only changed fields; clearing an optional field sends null', () => {
  const before = formFrom(user);
  expect(changes(before, before, true)).toEqual({});
  expect(changes({ ...before, roomNumber: ' B-215 ', altPhone: '', hostelId: NO_HOSTEL }, before, true)).toEqual({
    roomNumber: 'B-215',
    altPhone: null,
    hostelId: null,
  });
});

it('never sends a blank required field, and operators only edit their phone', () => {
  const before = formFrom(user);
  expect(changes({ ...before, phone: '  ', idNumber: '' }, before, true)).toEqual({});
  expect(changes({ ...before, phone: '9000000001', roomNumber: 'X' }, before, false)).toEqual({ phone: '9000000001' });
});

it('registration leaves blank optional fields out', () => {
  expect(registration({ ...formFrom(), idNumber: ' 23cs1 ', phone: '98765 43210', personalEmail: ' ' })).toEqual({
    memberType: 'STUDENT',
    idNumber: '23cs1',
    phone: '98765 43210',
    altPhone: undefined,
    personalEmail: undefined,
    hostelId: undefined,
    roomNumber: undefined,
  });
});
