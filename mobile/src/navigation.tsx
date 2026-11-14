import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { Schema } from './api/service';
import { home, useSession } from './session/SessionProvider';
import { colors } from './ui';

type Tab = { name: string; title: string; icon: ComponentProps<typeof Ionicons>['name'] };

/** A role's section: only that role gets in; anyone else is sent to their own home. */
export function RoleTabs({ role, tabs }: { role: Schema<'Role'>; tabs: Tab[] }) {
  const { user, ready } = useSession();
  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== role) return <Redirect href={home(user.role)} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line, minHeight: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {tabs.map(tab => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} color={color as string} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}
