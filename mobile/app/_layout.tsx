import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RuntimeProvider } from '../src/runtime';
import { MotionProvider } from '../src/motion';
import { DemoBanner, colors } from '../src/ui';
export { ErrorBoundary } from 'expo-router';
export default function RootLayout() { return <RuntimeProvider><MotionProvider><SafeAreaView edges={['top']} style={{ flex: 1, minHeight: 0, height: '100%', maxHeight: '100%', backgroundColor: colors.ink }}><StatusBar style="light" /><DemoBanner /><View style={{ flex: 1, minHeight: 0 }}><Stack screenOptions={{ headerShown: false }} /></View></SafeAreaView></MotionProvider></RuntimeProvider>; }
