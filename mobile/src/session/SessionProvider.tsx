import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { startRealtime } from '../realtime';
import { watchResource } from '../refresh';
import { createHttpService, normalizeBaseUrl } from '../api/http';
import { ServiceError, errorText, type MailroomService, type Schema } from '../api/service';

type User = Schema<'User'>;
const baseUrl = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? '');
const { api, setToken: setHttpToken } = createHttpService(baseUrl);

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
  const [bearer, setBearer] = useState<string>();
  const userId = user?.id;
  const setToken = useCallback((value: string | undefined) => {
    setHttpToken(value);
    setBearer(value);
  }, []);

  const forget = useCallback(async () => {
    setToken(undefined);
    setUser(null);
    await tokenStore.clear();
  }, [setToken]);

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
  }, [forget, setToken]);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    if (!ready || !userId || !bearer) return;
    const live = startRealtime(baseUrl, bearer, () => void forget());
    const isActive = () =>
      Platform.OS === 'web'
        ? document.visibilityState !== 'hidden'
        : AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const account = watchResource(
      () => api.getMe({}),
      updated =>
        setUser(current =>
          current?.id === updated.id && JSON.stringify(current) !== JSON.stringify(updated) ? updated : current,
        ),
      error => {
        if (error instanceof ServiceError && error.code === 'UNAUTHENTICATED') void forget();
      },
      () => undefined,
      isActive,
    );
    const foreground = () => {
      live.setActive(isActive());
      if (isActive()) account.refresh();
    };
    const subscription = AppState.addEventListener('change', foreground);
    foreground();
    if (Platform.OS === 'web') {
      document.addEventListener('visibilitychange', foreground);
      window.addEventListener('online', live.reconnect);
    }
    return () => {
      subscription.remove();
      account.stop();
      live.stop();
      if (Platform.OS === 'web') {
        document.removeEventListener('visibilitychange', foreground);
        window.removeEventListener('online', live.reconnect);
      }
    };
  }, [ready, userId, bearer, forget]);

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
      // Dispatch with the old token, but don't strand the user on this account if the network is slow.
      const revoked = api.logout({}).catch(() => undefined);
      await forget();
      await revoked;
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
