import type { Handlers } from '../../contract.js';
import * as auth from './service.js';

export const handlers = {
  register: auth.register,
  verifyEmail: auth.verifyEmail,
  resendCode: auth.resendCode,
  login: auth.login,
  forgotPassword: auth.forgotPassword,
  resetPassword: auth.resetPassword,
  logout: (_input, ctx) => auth.logout(ctx),
  changePassword: auth.changePassword,
} satisfies Partial<Handlers>;
