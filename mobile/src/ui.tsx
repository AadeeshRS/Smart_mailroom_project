import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRuntime } from './runtime';

export const colors = { ink: '#142D38', muted: '#526974', teal: '#006B5B', pale: '#E3F1EB', paper: '#F5F6F2', white: '#FFFFFF', line: '#D8E2DE', amber: '#825112', amberPale: '#FFF2D8', red: '#A02D36', redPale: '#FCECEF' };
export const styles = StyleSheet.create({
  page: { flex: 1, minHeight: 0, height: '100%', maxHeight: '100%', overflow: 'hidden', backgroundColor: colors.paper },
  content: { padding: 22, paddingBottom: 42, gap: 18, width: '100%', maxWidth: 720, alignSelf: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  card: { backgroundColor: colors.white, borderRadius: 20, padding: 20, gap: 12, borderWidth: 1, borderColor: colors.line },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.8, color: colors.ink },
  h2: { fontSize: 20, lineHeight: 27, fontWeight: '700', color: colors.ink },
  text: { fontSize: 16, lineHeight: 24, color: colors.ink },
  muted: { fontSize: 14, lineHeight: 21, color: colors.muted },
  eyebrow: { fontSize: 12, lineHeight: 18, color: colors.teal, letterSpacing: 1.6, fontWeight: '800' },
  button: { minHeight: 48, paddingVertical: 13, paddingHorizontal: 18, backgroundColor: colors.teal, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#9DB1AC', backgroundColor: colors.white, borderRadius: 12, padding: 14, fontSize: 16, minHeight: 50, color: colors.ink },
});
export function DemoBanner() {
  const { mode } = useRuntime();
  return <View style={{ flexShrink: 0, backgroundColor: colors.ink, paddingHorizontal: 20, paddingVertical: 9 }}><Text style={{ color: '#F0F5DB', textAlign: 'center', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>{mode === 'http' ? 'HTTP DEMO · POSTGRESQL · SYNTHETIC DATA ONLY' : 'DEMO MODE · SYNTHETIC DATA ONLY'}</Text></View>;
}
export function Page({ title, subtitle, children, back, modal = false }: { title: string; subtitle?: string; children: React.ReactNode; back?: () => void; modal?: boolean }) {
  const { online, toggleOnline } = useRuntime();
  return <SafeAreaView style={styles.page} edges={modal ? ['top', 'left', 'right'] : ['left', 'right']}>
    {modal && <DemoBanner />}
    {!online && <Pressable accessibilityRole="button" onPress={toggleOnline} style={{ padding: 12, backgroundColor: colors.amberPale }}><Text style={styles.text}>Simulated offline · Tap to reconnect</Text></Pressable>}
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, minHeight: 0 }}><ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {back && <Button label="‹ Back" variant="quiet" onPress={back} />}
      <View style={{ gap: 8 }}><Text style={styles.eyebrow}>SMART MAILROOM</Text><Text accessibilityRole="header" style={styles.title}>{title}</Text>{subtitle && <Text style={styles.muted}>{subtitle}</Text>}</View>
      {children}
    </ScrollView></KeyboardAvoidingView>
  </SafeAreaView>;
}
export const Card = ({ children }: { children: React.ReactNode }) => <View style={styles.card}>{children}</View>;
export const Heading = ({ children }: { children: React.ReactNode }) => <Text accessibilityRole="header" style={styles.h2}>{children}</Text>;
export const Body = ({ children }: { children: React.ReactNode }) => <Text style={styles.text}>{children}</Text>;
export const Muted = ({ children }: { children: React.ReactNode }) => <Text style={styles.muted}>{children}</Text>;
export function Button({ label, onPress, disabled, busy, variant = 'primary' }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; variant?: 'primary' | 'quiet' | 'danger' }) {
  const quiet = variant === 'quiet';
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, quiet && { backgroundColor: colors.pale }, variant === 'danger' && { backgroundColor: colors.red }, { opacity: disabled || busy ? 0.55 : pressed ? 0.8 : 1 }]}>
    {busy ? <ActivityIndicator color={quiet ? colors.teal : colors.white} accessibilityLabel="Working" /> : <Text style={[styles.buttonText, quiet && { color: colors.teal }]}>{label}</Text>}
  </Pressable>;
}
export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return <View style={{ gap: 7 }}><Text style={{ ...styles.text, fontWeight: '600' }}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#667D84" autoCorrect={false} style={styles.input} {...props} />{hint && <Muted>{hint}</Muted>}</View>;
}
export const human = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, s => s.toUpperCase());
export function Tag({ value }: { value: string }) {
  const bad = /CONFLICT|DISPUTE|AMBIGUOUS|INVALIDATED|FAILED|HOLD/.test(value);
  const warning = /PENDING|AWAITING_MATCH|REVIEW|EXPIRED|NO_MATCH|INSUFFICIENT/.test(value);
  return <View style={{ alignSelf: 'flex-start', backgroundColor: bad ? colors.redPale : warning ? colors.amberPale : colors.pale, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}><Text style={{ fontSize: 12, lineHeight: 18, fontWeight: '700', color: bad ? colors.red : warning ? colors.amber : colors.teal }}>{human(value)}</Text></View>;
}
export function Notice({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return <View accessibilityRole={danger ? 'alert' : undefined} style={{ padding: 16, borderRadius: 12, gap: 6, backgroundColor: danger ? colors.redPale : colors.amberPale }}><Text style={{ ...styles.text, fontSize: 14, color: danger ? colors.red : colors.amber }}>{children}</Text></View>;
}
export function Feedback({ error }: { error: string }) { return error ? <Notice danger>{error}</Notice> : null; }
export function ResourceState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  return loading ? <ActivityIndicator color={colors.teal} accessibilityLabel="Loading" /> : error ? <Card><Feedback error={error} /><Button label="Retry" onPress={retry} /></Card> : null;
}
export function Empty({ title, detail }: { title: string; detail: string }) { return <Card><Heading>{title}</Heading><Muted>{detail}</Muted></Card>; }
export function Choice<T extends string>({ label, values, value, onChange }: { label: string; values: readonly T[]; value: T; onChange: (value: T) => void }) {
  return <View style={{ gap: 9 }}><Body>{label}</Body><View style={styles.row}>{values.map(item => <Pressable key={item} accessibilityRole="radio" accessibilityLabel={human(item)} accessibilityState={{ checked: value === item }} onPress={() => onChange(item)} style={{ borderWidth: 1, borderColor: value === item ? colors.teal : colors.line, backgroundColor: value === item ? colors.pale : colors.white, borderRadius: 10, padding: 13, minHeight: 48 }}><Text style={{ color: colors.ink, fontWeight: value === item ? '700' : '400' }}>{human(item)}</Text></Pressable>)}</View></View>;
}
export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={{ ...styles.row, flexWrap: 'nowrap', minHeight: 48, paddingVertical: 8 }}><View style={{ width: 26, height: 26, borderWidth: 2, borderRadius: 6, borderColor: colors.teal, backgroundColor: checked ? colors.teal : colors.white, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.white, fontWeight: '800' }}>{checked ? '✓' : ''}</Text></View><Text style={{ ...styles.text, flex: 1 }}>{label}</Text></Pressable>;
}
export const date = (value: string) => new Date(value).toLocaleString();
