import type { Hostel } from '@prisma/client';
import type { Handlers } from '../../contract.js';
import { uniqueViolation } from '../../core/db.js';
import { fail } from '../../core/errors.js';
import { id } from '../../core/security.js';

const named = async (write: () => Promise<Hostel>) => {
  try {
    return await write();
  } catch (error) {
    if (uniqueViolation(error) === 'name') fail('NAME_TAKEN', 'A hostel with this name already exists.');
    throw error;
  }
};

export const handlers = {
  listHostels: async (_input, ctx) => ({ items: await ctx.db.hostel.findMany({ orderBy: { name: 'asc' } }) }),
  createHostel: (input, ctx) => named(() => ctx.db.hostel.create({ data: { id: id('hst'), name: input.name.trim() } })),
  updateHostel: async ({ hostelId, ...input }, ctx) => {
    if (!(await ctx.db.hostel.findUnique({ where: { id: hostelId } }))) fail('NOT_FOUND', 'Hostel not found.');
    return named(() =>
      ctx.db.hostel.update({ where: { id: hostelId }, data: { name: input.name?.trim(), active: input.active } }),
    );
  },
} satisfies Partial<Handlers>;
