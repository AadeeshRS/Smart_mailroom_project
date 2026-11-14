import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { createHttpService, normalizeBaseUrl } from '../api/http';
import { ServiceError, errorText, type MailroomService, type Schema } from '../api/service';

type User = Schema<'User'>;
const { api, setToken } = createHttpService(normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? ''));

// The token lives in the OS keychain/keystore; web has no SecureStore, so it uses browser storage.
const KEY = 'smart-mailroom.token';
const tokenStore =
  Platform.OS === 'web'
    ? {
        get: () => AsyncStorage.getItem(KEY),
        set: (value: string) => AsyncStorage.setItem(KEY, value),
        clear: () => AsyncStorage.removeItem(KEY),
      }
    : {
        get: () => SecureStore.getItemAsync(KEY),
        set: (value: string) => SecureStore.setItemAsync(KEY, value),
        clear: () => SecureStore.deleteItemAsync(KEY),
      };

/** Where each role lands after signing in. */
export const home = (role: User['role']) =>
  role === 'MEMBER' ? '/member' : role === 'OPERATOR' ? '/operator/scan' : '/admin/dashboard';

type Session = {
  api: MailroomService;
  user: User | null;
  /** False until the saved token has been checked on launch. */
  ready: boolean;
  /** Set when the saved session couldn't be checked (offline); `restore` retries. */
  restoreError: string;
  restore: () => void;
  signIn: (session: Schema<'Session'>) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
  /** Message for an error; an UNAUTHENTICATED error also signs the user out locally. */
  handleError: (error: unknown) => string;
};
const Context = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  const forget = useCallback(async () => {
    setToken(undefined);
    setUser(null);
    await tokenStore.clear();
  }, []);

  const restore = useCallback(async () => {
    setReady(false);
    setRestoreError('');
    try {
      const token = await tokenStore.get();
      if (token) {
        setToken(token);
        setUser(await api.getMe({}));
      }
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'UNAUTHENTICATED') await forget();
      else setRestoreError(error instanceof ServiceError ? error.message : 'Your session could not be restored.');
    } finally {
      setReady(true);
    }
  }, [forget]);

  useEffect(() => {
    void restore();
  }, [restore]);

  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof ServiceError && error.code === 'UNAUTHENTICATED' && user) void forget();
      return errorText(error);
    },
    [forget, user],
  );

  const value: Session = {
    api,
    user,
    ready,
    restoreError,
    restore: () => void restore(),
    signIn: async session => {
      setToken(session.token);
      await tokenStore.set(session.token);
      setUser(session.user);
    },
    signOut: async () => {
      await api.logout({}).catch(() => undefined);
      await forget();
    },
    setUser,
    handleError,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error('useSession must be inside SessionProvider');
  return value;
}
