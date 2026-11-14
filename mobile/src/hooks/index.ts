import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useSession } from '../session/SessionProvider';

/** Load data whenever the screen gains focus, or when `key` changes or `retry` is called. */
export function useResource<T>(loader: () => Promise<T>, key = '') {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const { handleError } = useSession();
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError('');
      loaderRef
        .current()
        .then(value => {
          if (active) setData(value);
        })
        .catch(reason => {
          if (active) setError(handleError(reason));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
      // key/revision deliberately invalidate the latest loader held in loaderRef.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, revision, handleError]),
  );
  return { data, loading, error, retry: () => refresh(value => value + 1) };
}

/** Run one write at a time, exposing busy and a friendly error message. */
export function useAction() {
  const { handleError } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      return await action();
    } catch (reason) {
      setError(handleError(reason));
      return undefined;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { run, busy, error, clearError: () => setError('') };
}
