import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { LogBox, Platform } from 'react-native';
import type { MailroomService } from './api/service';
import { useSession } from './session/SessionProvider';

// Plan §0 rule 8: Expo Go can't receive pushes on Android (SDK 53+), and even loading expo-notifications there
// warns, so it's loaded lazily, only on iOS or in a release build. Web gets no pushes.
const available = () => Platform.OS === 'ios' || (Platform.OS === 'android' && !isRunningInExpoGo());
/** Written to app.json by `eas init`; Expo Go needs it for a push token. */
const projectId = (): string | undefined =>
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

/** Members only: ask for permission, upload this phone's push token, and open Home when a notification is tapped.
 * Best effort: without a push, the member still sees the parcel on Home. */
export function usePushNotifications() {
  const { api } = useSession();
  useEffect(() => {
    if (!available() || !projectId()) return;
    let active = true;
    let stop: (() => void) | undefined;
    void register(api).then(remove => {
      if (active) stop = remove;
      else remove();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, [api]);
}

async function register(api: MailroomService) {
  if (isRunningInExpoGo())
    // Expo's own notices about Expo Go's push limits (one is about Android); on iOS, push still works in Expo Go.
    LogBox.ignoreLogs([
      '`expo-notifications` functionality is not fully supported in Expo Go',
      'expo-notifications: Android Push notifications (remote notifications) functionality',
    ]);
  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  const subscription = Notifications.addNotificationResponseReceivedListener(() => router.navigate('/member'));
  try {
    const current = await Notifications.getPermissionsAsync();
    const { granted } =
      current.granted || !current.canAskAgain ? current : await Notifications.requestPermissionsAsync();
    if (granted) {
      const { data } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
      await api.registerDevice({ token: data, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    }
  } catch {
    // No push this time (offline, simulator, or refused); Home still lists the parcels.
  }
  return () => subscription.remove();
}
