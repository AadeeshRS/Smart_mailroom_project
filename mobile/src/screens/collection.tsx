import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Scanner } from '../Scanner';
import { confirmWithRecovery } from '../confirmationRecovery';
import { ServiceError, type Schema } from '../api/service';
import { retryKey, useAction, useResource, useRuntime } from '../runtime';
import { Body, Button, Card, Check, Feedback, Field, Heading, Muted, Notice, Page, ResourceState, Tag, colors, date, styles } from '../ui';

export function ParcelDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { api, session } = useRuntime(); const router = useRouter();
  const resource = useResource<Schema<'Parcel'> | Schema<'StaffParcel'>>(() => session?.profile.role === 'STAFF' ? api.getStaffParcel({ parcelId: id }) : api.getParcel({ parcelId: id }), id);
  if (!session) return <Redirect href="/" />;
  const p = resource.data;
  return <Page title="Parcel details" back={() => router.back()}><ResourceState {...resource} />{p && !resource.error && <>
    <Card><View style={styles.spread}><Muted>{p.id}</Muted><Tag value={p.status} /></View><Heading>{p.description}</Heading><Body>Storage · {p.storageLocation}</Body><Muted>Physical reference: {p.physicalReference}</Muted><Muted>Received {date(p.receivedAt)}</Muted><Tag value={p.matchOutcome} /><Body>{p.matchExplanation}</Body>{'identifiers' in p && p.identifiers.map((i, index) => <Muted key={index}>{i.kind} · {i.namespace} · {i.value}</Muted>)}<Muted>Credential state: {p.credentialState.toLowerCase()}</Muted></Card>
    {p.hold !== 'NONE' && <Notice danger>Collection paused · {p.hold.toLowerCase()}: {p.holdReason}. Outstanding credentials are invalid.</Notice>}
    {p.collectionEligible ? session.profile.role === 'STUDENT' ? <Button label="Show collection OTP / QR" onPress={() => router.push(`/collect/${id}`)} /> : <Button label="Verify collection credential" onPress={() => router.push(`/verify/${id}`)} /> : p.status !== 'CLOSED' ? <Notice>Collection is unavailable until a validated assignment is in place and all holds are resolved.</Notice> : null}
    {session.profile.role === 'STAFF' && p.status !== 'CLOSED' && <Button label="Review evidence or collection hold" variant="quiet" onPress={() => router.push(`/review/${id}`)} />}
    {p.receiptId && <Button label="View retained handover receipt" onPress={() => router.push(`/receipt/${p.receiptId}`)} />}
    {'audit' in p && <Card><Heading>Audit history</Heading>{p.audit.map((event, index) => <View key={index} style={{ gap: 5, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line }}><Tag value={event.action} /><Body>{event.reason}</Body><Muted>{date(event.at)} · {event.actorId}</Muted></View>)}</Card>}
  </>}</Page>;
}
export function CredentialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { api, session } = useRuntime(); const router = useRouter(); const action = useAction();
  const resource = useResource(() => api.getParcel({ parcelId: id }), id);
  const [credential, setCredential] = useState<Schema<'Credential'>>(); const [clock, setClock] = useState(Date.now());
  const pending = useRef<{ key: string; replace: boolean } | undefined>(undefined);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useFocusEffect(useCallback(() => () => { setCredential(undefined); pending.current = undefined; }, []));
  useEffect(() => { const subscription = AppState.addEventListener('change', state => { if (state !== 'active') setCredential(undefined); }); return () => subscription.remove(); }, []);
  if (!session) return <Redirect href="/" />;
  if (session.profile.role !== 'STUDENT') return <Redirect href="/staff" />;
  const remaining = credential ? Math.max(0, Math.ceil((Date.parse(credential.expiresAt) - clock) / 1000)) : 0;
  function issue(replace: boolean, retry = false) {
    if (!retry || !pending.current) pending.current = { key: retryKey(), replace };
    const request = pending.current;
    action.run(async () => {
      try {
        const result = await api.issueCredential({ parcelId: id, replace: request.replace, idempotencyKey: request.key });
        setCredential(result); setClock(Date.now()); pending.current = undefined;
      } finally { resource.retry(); }
    });
  }
  return <Page title="Your collection code" subtitle="One physical parcel. One current credential." back={() => router.back()}><ResourceState {...resource} />{resource.data && !resource.error && <Card><Heading>{resource.data.description}</Heading><Body>{id} · {resource.data.storageLocation}</Body>{!resource.data.collectionEligible && <Notice danger>{resource.data.holdReason || 'This parcel is not eligible for collection.'}</Notice>}</Card>}
    {credential && remaining > 0 && <Card><Tag value="ACTIVE" /><Muted>Show at the mailroom · code does not prove physical handover</Muted><Text selectable accessibilityLabel="Collection OTP" style={{ color: colors.ink, fontSize: 42, fontWeight: '800', letterSpacing: 8, textAlign: 'center', paddingVertical: 10 }}>{credential.otp}</Text><View accessibilityLabel="Collection QR code" style={{ alignItems: 'center', backgroundColor: colors.white, padding: 18 }}><QRCode value={JSON.stringify(credential.qr)} size={210} color={colors.ink} backgroundColor={colors.white} /></View><Text accessibilityLiveRegion="polite" style={{ ...styles.text, textAlign: 'center', fontWeight: '700' }}>Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</Text><Muted>QR contains only a version, credential reference and opaque demo token. No personal information.</Muted></Card>}
    {credential && !remaining && <Notice danger>This code has expired. Request a replacement before collection.</Notice>}
    <Feedback error={action.error} />
    {resource.data?.collectionEligible && <><Button label={credential || resource.data.credentialState !== 'NONE' ? 'Replace collection code' : 'Request collection code'} busy={action.busy} onPress={() => issue(!!credential || resource.data!.credentialState !== 'NONE')} />{action.error && pending.current && <Button label="Retry same issuance request" variant="quiet" busy={action.busy} onPress={() => issue(pending.current!.replace, true)} />}</>}
    <Notice>Valid for 10 minutes. Retry preserves the original issuance request. Explicit replacement uses a new key and invalidates the previous OTP and QR. If the original secrets cannot be replayed, choose replacement. Five failed OTP attempts invalidate the credential. Codes clear when you leave or background the app.</Notice>
  </Page>;
}

// Verification secrets stay in volatile module memory, never route parameters or local storage.
let pendingVerification: Schema<'Verification'> | undefined;
export function VerifyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { api, session } = useRuntime(); const router = useRouter(); const action = useAction(); const [otp, setOtp] = useState(''); const [scanner, setScanner] = useState(false);
  const resource = useResource(() => api.getParcel({ parcelId: id }), id);
  if (!session) return <Redirect href="/" />;
  if (session.profile.role !== 'STAFF') return <Redirect href="/student" />;
  async function verify(method: 'OTP' | 'QR', raw?: string) {
    await action.run(async () => {
      let qr: Schema<'QrPayload'> | undefined;
      if (method === 'QR') {
        try { qr = JSON.parse(raw ?? '') as Schema<'QrPayload'>; } catch { throw new ServiceError('VALIDATION', 'Scanned text is not a collection QR payload. Use the student’s current QR or parcel-scoped OTP.'); }
      }
      pendingVerification = method === 'OTP' ? await api.verifyCredential({ parcelId: id, method: 'OTP', otp }) : await api.verifyCredential({ parcelId: id, method: 'QR', qr: qr! });
      setOtp(''); router.push(`/confirm/${id}`);
    });
  }
  return <Page title="Verify collection" subtitle="Verification checks the credential. Handover is a separate action." back={() => router.back()}><ResourceState {...resource} /><Scanner open={scanner} purpose="CREDENTIAL" onClose={() => setScanner(false)} onScan={raw => { verify('QR', raw); }} />{resource.data && !resource.error && <Card><Heading>{resource.data.description}</Heading><Body>{id} · {resource.data.storageLocation}</Body><Tag value={resource.data.status} />{!resource.data.collectionEligible && <Notice danger>{resource.data.holdReason || 'Parcel is not eligible for collection.'}</Notice>}</Card>}
    <Card><Heading>Scan current QR</Heading><Button label="Scan student collection QR" disabled={!resource.data?.collectionEligible} busy={action.busy} onPress={() => setScanner(true)} /><Muted>If the camera is unavailable or denied, use the six-digit OTP below.</Muted></Card>
    <Card><Heading>Parcel-scoped OTP</Heading><Field label="Six-digit collection OTP" value={otp} onChangeText={value => setOtp(value.replace(/\D/g, ''))} maxLength={6} keyboardType="number-pad" autoComplete="off" hint={`This OTP will be checked only for ${id}.`} /><Feedback error={action.error} /><Button label="Verify OTP" busy={action.busy} disabled={!resource.data?.collectionEligible || otp.length !== 6} onPress={() => verify('OTP')} /></Card>
  </Page>;
}
export function ConfirmScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { api, session, recovery, loseNextConfirmationResponse, mode } = useRuntime(); const router = useRouter(); const action = useAction();
  const [uncertain, setUncertain] = useState(false); const [simulateLoss, setSimulateLoss] = useState(false);
  const [verification] = useState(() => pendingVerification?.parcelId === id ? pendingVerification : undefined);
  const [confirmed, setConfirmed] = useState(false); const key = useRef<string | undefined>(undefined); const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!session) return <Redirect href="/" />;
  if (session.profile.role !== 'STAFF') return <Redirect href="/student" />;
  if (!verification) return <Page title="Verify before handover" back={() => router.back()}><Notice>No current verification is available on this device. Verify the credential again.</Notice><Button label="Return to verification" onPress={() => router.replace(`/verify/${id}`)} /></Page>;
  const expired = clock >= Date.parse(verification.expiresAt);
  return <Page title="Confirm physical handover" subtitle="Inspect the student and the exact physical parcel before release." back={() => router.back()}>
    <Card><Tag value="CREDENTIAL_VERIFIED" /><Heading>{verification.student.name}</Heading><Body>{verification.student.email}</Body><Body>Student number · {verification.student.studentNumber}</Body><Heading>{verification.parcel.description}</Heading><Body>Parcel · {verification.parcelId}</Body><Body>Physical reference · {verification.parcel.physicalReference}</Body><Body>Storage · {verification.parcel.storageLocation}</Body><Muted>Bound to parcel revision {verification.parcelRevision}. Verification expires {date(verification.expiresAt)}.</Muted></Card>
    {expired && !uncertain && <Notice danger>Verification expired. Return and verify the current credential again.</Notice>}
    <Feedback error={action.error} />
    {uncertain ? <Card><Heading>Original confirmation saved</Heading><Notice>The response is uncertain. Recover this saved request with its original key, including after reload or verification expiry.</Notice><Button label="Recover original confirmation" onPress={() => router.replace(`/recover/${id}`)} /></Card> : <>{mode === 'mock' && <Check label="Simulate a lost confirmation response once" checked={simulateLoss} onChange={setSimulateLoss} />}<Check label="I checked the student and parcel details and physically handed over this exact parcel" checked={confirmed} onChange={setConfirmed} />
    <Button label="Confirm handover and save receipt" disabled={!confirmed || expired} busy={action.busy} onPress={() => action.run(async () => {
      const existing = await recovery.get(session.profile.id, id);
      if (existing) { setUncertain(true); router.replace(`/recover/${id}`); return; }
      key.current ??= retryKey();
      if (simulateLoss) loseNextConfirmationResponse();
      setUncertain(true);
      try {
        const result = await confirmWithRecovery(recovery, api, session.profile.id, { parcelId: id, verificationId: verification.id, physicalHandoverConfirmed: confirmed, idempotencyKey: key.current });
        pendingVerification = undefined; router.replace(`/receipt/${result.receipt.id}`);
      } finally { setUncertain(!!await recovery.get(session.profile.id, id)); }
    })} /></>}<Button label="Verify credential again" disabled={uncertain} variant="quiet" onPress={() => { pendingVerification = undefined; router.replace(`/verify/${id}`); }} />
    <Muted>Retrying this confirmation uses the same key and returns the original receipt after a successful save. The service rechecks holds, expiry, revision and credential state.</Muted>
  </Page>;
}
export function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { api, session } = useRuntime(); const router = useRouter();
  const resource = useResource<Schema<'Receipt'> | Schema<'StaffReceipt'>>(() => session?.profile.role === 'STAFF' ? api.getStaffReceipt({ receiptId: id }) : api.getReceipt({ receiptId: id }), id);
  if (!session) return <Redirect href="/" />;
  return <Page title="Handover receipt" subtitle="Collected and retained in your demo history." back={() => router.back()}><ResourceState {...resource} />{resource.data && !resource.error && <><Card><Tag value="CLOSED" /><Heading>Physical handover recorded</Heading><Body>Receipt · {resource.data.id}</Body><Body>Parcel · {resource.data.parcelId}</Body><Body>Expected order · {resource.data.orderId}</Body><Body>Student · {resource.data.studentId}</Body>{'staffId' in resource.data && <Body>Confirmed by · {resource.data.staffId}</Body>}<Body>{date(resource.data.confirmedAt)}</Body><Muted>Storage at collection · {resource.data.storageLocation}</Muted>{'verificationId' in resource.data && <Muted>Verification reference · {resource.data.verificationId}</Muted>}</Card><Notice>The collection credential is consumed. This receipt and closed parcel remain searchable after app restart.</Notice><Button label="View closed parcel and history" variant="quiet" onPress={() => router.push(`/parcel/${resource.data!.parcelId}`)} /><Button label="Return to overview" onPress={() => router.replace(session.profile.role === 'STAFF' ? '/staff' : '/student')} /></>}</Page>;
}
