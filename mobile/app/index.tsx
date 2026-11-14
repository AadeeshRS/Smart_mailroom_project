import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { home, useSession } from '../src/session/SessionProvider';
import { Button, Card, Feedback, Page, colors } from '../src/ui';

/** Launch: wait for the saved session, then send each role to its own section. */
export default function Index() {
  const { user, ready, restoreError, restore } = useSession();
  if (!ready) return <ActivityIndicator style={{ flex: 1 }} color={colors.teal} accessibilityLabel="Loading" />;
  if (restoreError)
    return (
      <Page title="Can't reach the mailroom">
        <Card>
          <Feedback error={restoreError} />
          <Button label="Try again" onPress={restore} />
        </Card>
      </Page>
    );
  return <Redirect href={user ? home(user.role) : '/login'} />;
}
