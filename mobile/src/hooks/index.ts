import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { watchResource } from '../refresh';
import { useSession } from '../session/SessionProvider';

/** Keep focused screens current, including external writes and foreground/network recovery. */
export function useResource<T>(loader: () => Promise<T>, key = '', enabled = true) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const { handleError, user } = useSession();
  const owner = user?.id;
  const [snapshot, setSnapshot] = useState<{ key: string; owner?: string; value: T }>();
  const data = snapshot?.key === key && snapshot.owner === owner ? snapshot.value : undefined;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      setLoading(true);
      setError('');
      const isActive = () =>
        Platform.OS === 'web'
          ? typeof document !== 'undefined' && document.visibilityState !== 'hidden'
          : AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
      const live = watchResource(
        () => loaderRef.current(),
        value => {
          setSnapshot({ key, owner, value });
          setError('');
        },
        reason => setError(handleError(reason)),
        () => setLoading(false),
        isActive,
      );
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') live.refresh();
      });
      if (Platform.OS === 'web') {
        document.addEventListener('visibilitychange', live.refresh);
        window.addEventListener('focus', live.refresh);
        window.addEventListener('online', live.refresh);
      }
      return () => {
        live.stop();
        subscription.remove();
        if (Platform.OS === 'web') {
          document.removeEventListener('visibilitychange', live.refresh);
          window.removeEventListener('focus', live.refresh);
          window.removeEventListener('online', live.refresh);
        }
      };
      // key/revision deliberately invalidate the latest loader held in loaderRef.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, owner, enabled, revision, handleError]),
  );
  return { data, loading, error, retry: () => refresh(value => value + 1) };
}

/** Run one write at a time, exposing busy and a friendly error message. */
export function useAction() {
  const { handleError, user } = useSession();
  const owner = user?.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<unknown>();
  const scope = useRef({ owner, mounted: true, version: 0, running: false });
  if (scope.current.owner !== owner) {
    scope.current.owner = owner;
    scope.current.version++;
    scope.current.running = false;
  }
  useEffect(() => {
    const current = scope.current;
    current.mounted = true;
    setBusy(false);
    setError('');
    setFailure(undefined);
    return () => {
      current.mounted = false;
      current.version++;
      current.running = false;
    };
  }, [owner]);
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (!scope.current.mounted || scope.current.running) return undefined;
    scope.current.running = true;
    const version = ++scope.current.version;
    const current = () => scope.current.mounted && scope.current.owner === owner && scope.current.version === version;
    setBusy(true);
    setError('');
    setFailure(undefined);
    try {
      const result = await action();
      return current() ? result : undefined;
    } catch (reason) {
      if (current()) {
        setFailure(reason);
        setError(handleError(reason));
      }
      return undefined;
    } finally {
      if (current()) {
        scope.current.running = false;
        setBusy(false);
      }
    }
  }
  return {
    run,
    busy,
    error,
    failure,
    clearError: () => {
      setError('');
      setFailure(undefined);
    },
  };
}
