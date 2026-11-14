import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotionProvider } from '../src/motion';
import { SessionProvider } from '../src/session/SessionProvider';
import { colors } from '../src/ui';
export { ErrorBoundary } from 'expo-router';

export default function RootLayout() {
  return (
    <SessionProvider>
      <MotionProvider>
        <SafeAreaView
          edges={['top']}
          style={{ flex: 1, minHeight: 0, height: '100%', maxHeight: '100%', backgroundColor: colors.ink }}
        >
          <StatusBar style="light" />
          <View style={{ flex: 1, minHeight: 0 }}>
            <Stack screenOptions={{ headerShown: false }} />
          </View>
        </SafeAreaView>
      </MotionProvider>
    </SessionProvider>
  );
}
