import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { useRuntime } from '../runtime';
import { colors } from '../ui';

export function RoleTabs({ role }: { role: 'STUDENT' | 'STAFF' }) {
  const { session } = useRuntime();
  if (!session) return <Redirect href="/" />;
  if (session.profile.role !== role) return <Redirect href={session.profile.role === 'STAFF' ? '/staff' : '/student'} />;
  const screens = role === 'STUDENT'
    ? [{ name: 'index', title: 'Overview', icon: 'grid-outline' }, { name: 'orders', title: 'Orders', icon: 'bag-handle-outline' }, { name: 'parcels', title: 'Parcels', icon: 'cube-outline' }, { name: 'inbox', title: 'Inbox', icon: 'mail-outline' }, { name: 'account', title: 'Account', icon: 'person-outline' }]
    : [{ name: 'index', title: 'Overview', icon: 'grid-outline' }, { name: 'parcels', title: 'Parcels', icon: 'cube-outline' }, { name: 'intake', title: 'Intake', icon: 'scan-outline' }, { name: 'account', title: 'Account', icon: 'person-outline' }];
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.teal, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line, minHeight: 64, paddingTop: 6, paddingBottom: 8 }, tabBarLabelStyle: { fontSize: 11, fontWeight: '600' } }}>{screens.map(s => <Tabs.Screen key={s.name} name={s.name} options={{ title: s.title, tabBarIcon: ({ color, size }) => <Ionicons name={s.icon as React.ComponentProps<typeof Ionicons>['name']} color={color} size={size} /> }} />)}</Tabs>;
}
