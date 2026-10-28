import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { DEMO_PASSCODE } from '../api/service';
import { useAction, useRuntime } from '../runtime';
import { Body, Button, Card, Check, Choice, Feedback, Field, Heading, Muted, Notice, Page, colors, date, styles } from '../ui';

export function LoginScreen() {
  const { api, session, setSession, sessionNotice, mode, apiBaseUrl, accounts } = useRuntime(); const router = useRouter(); const action = useAction();
  const [account, setAccount] = useState<string>(accounts[0]?.id ?? ''); const [passcode, setPasscode] = useState(mode === 'mock' ? DEMO_PASSCODE : '');
  if (session) return <Redirect href={session.profile.role === 'STAFF' ? '/staff' : '/student'} />;
  return <Page title="A better way to pick up." subtitle="Your orders, their arrival, and a clear path to collection.">
    {sessionNotice && <Notice>{sessionNotice}</Notice>}
    <View style={{ padding: 24, backgroundColor: colors.teal, borderRadius: 24, gap: 14 }}><Text style={{ fontSize: 44 }}>▧</Text><Text style={{ color: colors.white, fontWeight: '800', fontSize: 24, lineHeight: 30 }}>One order. Every parcel. Safely accounted for.</Text><Text style={{ color: '#DFF1EB', lineHeight: 23, fontSize: 15 }}>Register your order before it arrives. Collect each shipment with its own code.</Text></View>
    <Card><Heading>Demonstration login</Heading><Muted>Choose a provisioned fictitious account. The {mode === 'http' ? 'server' : 'mock service'} determines its role. This is not college authentication or SSO.</Muted>
      {mode === 'http' && <><Muted>Backend: {apiBaseUrl}</Muted><Field label="Provisioned server account ID" value={account} onChangeText={setAccount} maxLength={128} autoCapitalize="none" hint="Use an account ID printed by the backend seed command. No role is selected or sent." /></>}
      {accounts.map(item => <Button key={item.id} variant={account === item.id ? 'primary' : 'quiet'} label={`${item.name} · ${item.detail}`} onPress={() => setAccount(item.id)} />)}
      <Field label="Demo passcode" value={passcode} onChangeText={setPasscode} secureTextEntry autoCapitalize="none" hint={mode === 'mock' ? `Public demonstration passcode: ${DEMO_PASSCODE}` : 'Enter the synthetic passcode configured when the server accounts were seeded.'} />
      <Feedback error={action.error} /><Button label="Sign in to demo" busy={action.busy} onPress={() => action.run(async () => { const result = await api.login({ accountId: account, passcode }); setSession(result); router.replace(result.profile.role === 'STAFF' ? '/staff' : '/student'); })} />
    </Card><Notice>{mode === 'http' ? 'Synthetic data persists in the configured PostgreSQL backend. HTTP failures never fall back to local mock data.' : 'Local synthetic data only.'} No real SMS, push notification, shopping service, or courier connection.</Notice>
  </Page>;
}
export function AccountScreen() {
  const { session, api, setSession, online, toggleOnline, recovery, mode } = useRuntime(); const router = useRouter(); const action = useAction(); const [reset, setReset] = useState(false);
  if (!session) return <Redirect href="/" />;
  return <Page title="Your demo account" subtitle={`Provisioned identity · ${mode === 'http' ? 'HTTP backend demonstration' : 'local demonstration'}`}>
    <Card><Heading>{session.profile.name}</Heading><Body>{session.profile.email}</Body>{session.profile.studentNumber && <Body>Student number: {session.profile.studentNumber}</Body>}<Muted>Role: {session.profile.role === 'STAFF' ? 'Mailroom staff' : 'Student'}</Muted><Muted>Session expires {date(session.expiresAt)}. Sign in again after expiry. Sessions and displayed credential secrets are not restored after app restart.</Muted></Card>
    {mode === 'mock' && <Card><Heading>Connection simulation</Heading><Muted>Exercise the network-error and retry UI without contacting a server.</Muted><Choice label="Mock transport" values={['ONLINE', 'OFFLINE'] as const} value={online ? 'ONLINE' : 'OFFLINE'} onChange={value => { if ((value === 'ONLINE') !== online) toggleOnline(); }} /></Card>}
    <Feedback error={action.error} /><Button label="Log out" busy={action.busy} variant="quiet" onPress={() => action.run(async () => { await api.logout({}); setSession(null); router.replace('/'); })} />
    {session.profile.role === 'STAFF' && <Card><Heading>Reset demo data</Heading><Muted>Deletes synthetic orders, parcels, notifications and retained receipts {mode === 'http' ? 'in the dedicated server demonstration database (development only)' : 'on this device'}. All demo sessions will end.</Muted><Check label={mode === 'http' ? 'I want to erase the dedicated server’s synthetic dataset' : 'I want to erase this device’s demo history'} checked={reset} onChange={setReset} /><Button label="Reset synthetic demo data" variant="danger" disabled={!reset} busy={action.busy} onPress={() => action.run(async () => { await api.resetDemo({}); await recovery.reset(session.profile.id); setSession(null); router.replace('/'); })} /></Card>}
    <View style={styles.row}><Muted>Smart Mailroom · Frontend prototype</Muted></View>
  </Page>;
}
