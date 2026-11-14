import { Redirect, Stack } from 'expo-router';
import { home, useSession } from '../../src/session/SessionProvider';

/** Signed-in users skip the auth screens. */
export default function AuthLayout() {
  const { user, ready } = useSession();
  if (ready && user) return <Redirect href={home(user.role)} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
