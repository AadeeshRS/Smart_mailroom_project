import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createMockKernel } from './api/mock';
import { ServiceError, type MailroomService, type Schema } from './api/service';

const kernel = createMockKernel(AsyncStorage);
const api = kernel.client();
type Runtime = {
  api: MailroomService; session: Schema<'Session'> | null;
  setSession: (session: Schema<'Session'> | null) => void;
  online: boolean; toggleOnline: () => void; handleError: (error: unknown) => string; sessionNotice: string;
};
const Context = createContext<Runtime | null>(null);
export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Schema<'Session'> | null>(null);
  const [online, setOnline] = useState(true);
  const [sessionNotice, setSessionNotice] = useState('');
  const router = useRouter();
  const handleError = useCallback((error: unknown) => {
    if (error instanceof ServiceError) {
      if (error.code === 'SESSION_EXPIRED' || error.code === 'UNAUTHENTICATED') { if (error.code === 'SESSION_EXPIRED') setSessionNotice(error.message); setSession(null); router.replace('/'); }
      return `${error.message} (${error.code})`;
    }
    return 'Something went wrong. Please retry.';
  }, [router]);
  useEffect(() => {
    if (!session) return;
    const expire = () => { if (Date.now() >= Date.parse(session.expiresAt)) { setSessionNotice('Your demonstration session expired. Sign in again.'); setSession(null); router.replace('/'); } };
    const timer = setTimeout(expire, Math.max(0, Date.parse(session.expiresAt) - Date.now()));
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') expire(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [session, router]);
  return <Context.Provider value={{ api, session, setSession: value => { setSession(value); if (value) setSessionNotice(''); }, sessionNotice, online, toggleOnline: () => { const value = !kernel.isOnline(); kernel.setOnline(value); setOnline(value); }, handleError }}>{children}</Context.Provider>;
}
export const useRuntime = () => { const value = useContext(Context); if (!value) throw new Error('Runtime missing'); return value; };

export function useResource<T>(loader: () => Promise<T>, key = '') {
  const loaderRef = useRef(loader); loaderRef.current = loader;
  const { handleError } = useRuntime();
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true); setError('');
    loaderRef.current().then(value => { if (active) setData(value); }).catch(reason => { if (active) setError(handleError(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // key/revision deliberately invalidate the latest loader held in loaderRef.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision, handleError]));
  return { data, loading, error, retry: () => refresh(value => value + 1) };
}
export function useAction() {
  const { handleError } = useRuntime();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (running.current) return undefined;
    running.current = true; setBusy(true); setError('');
    try { return await action(); } catch (reason) { setError(handleError(reason)); return undefined; }
    finally { running.current = false; setBusy(false); }
  }
  return { run, busy, error, clearError: () => setError('') };
}
let keySequence = 0;
export const retryKey = () => `demo-${Date.now()}-${++keySequence}`;
