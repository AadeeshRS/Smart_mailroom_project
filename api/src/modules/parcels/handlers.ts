import type { Handlers } from '../../contract.js';
import * as parcels from './service.js';

export const handlers = {
  lookupParcel: parcels.lookup,
  intakeParcel: parcels.intake,
  listParcels: parcels.list,
  getParcel: parcels.detail,
  assignParcel: parcels.assign,
  listMyParcels: parcels.mine,
} satisfies Partial<Handlers>;
