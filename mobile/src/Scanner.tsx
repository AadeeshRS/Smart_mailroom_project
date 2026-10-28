import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Platform, View } from 'react-native';
import { Button, Card, Heading, Muted, Notice, Page } from './ui';

/** Only decoded barcode text is returned. No OCR, identity inference, or auto-submission. */
export function Scanner({ open, purpose, onClose, onScan }: { open: boolean; purpose: 'LABEL' | 'CREDENTIAL'; onClose: () => void; onScan: (text: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [scanned, setScanned] = useState(false);
  const scanLock = useRef(false);
  useEffect(() => {
    if (!open) return;
    let active = true; setScanned(false); scanLock.current = false; setError(''); setAvailable(null);
    if (Platform.OS === 'web') CameraView.isAvailableAsync().then(value => { if (active) setAvailable(value); }).catch(() => { if (active) { setAvailable(false); setError('Camera could not be initialized.'); } });
    else setAvailable(true);
    return () => { active = false; };
  }, [open]);
  async function ask() {
    try { const result = await requestPermission(); if (!result.granted) setError('Camera access was denied or unavailable. Use manual entry, or enable camera access in device/browser settings.'); }
    catch { setError('Camera permission could not be requested. Use manual entry.'); }
  }
  return <Modal visible={open} animationType="slide" onRequestClose={onClose}><Page modal title={purpose === 'LABEL' ? 'Scan a parcel label' : 'Scan collection QR'} subtitle="Camera scanning requires a supported device and camera permission." back={onClose}>
    <Notice>{purpose === 'LABEL' ? 'A barcode contains text only. Review its type, namespace and value, then enter missing label evidence.' : 'Scan the student’s current parcel-specific QR. Verification still requires review and separate handover confirmation.'}</Notice>
    {error ? <Notice danger>{error}</Notice> : null}
    {available === false ? <Card><Heading>Camera unavailable</Heading><Muted>Use a supported physical device, or return to manual entry.</Muted></Card> : !permission?.granted ? <Card><Heading>Camera permission needed</Heading><Muted>{permission?.canAskAgain === false ? 'Permission was denied. Enable camera access in device or browser settings, or use manual entry.' : 'Allow camera access to scan. No photos or video are saved.'}</Muted>{permission?.canAskAgain !== false ? <Button label="Allow camera access" onPress={ask} /> : Platform.OS !== 'web' ? <Button label="Open device settings" onPress={() => { Linking.openSettings().catch(() => setError('Open device settings manually to enable camera access.')); }} /> : null}</Card> : available ? <View style={{ height: 340, borderRadius: 18, overflow: 'hidden' }}><CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: purpose === 'CREDENTIAL' ? ['qr'] : ['qr', 'code128', 'code39', 'ean13', 'ean8', 'pdf417', 'datamatrix', 'upc_a', 'upc_e'] }} onMountError={() => setError('Camera preview failed. Return to manual entry or try another supported device.')} onBarcodeScanned={scanned ? undefined : result => { if (scanLock.current) return; scanLock.current = true; setScanned(true); onScan(result.data); onClose(); }} /></View> : <Muted>Checking camera availability…</Muted>}
    <Button label={purpose === 'LABEL' ? 'Use manual label entry' : 'Use manual OTP entry'} variant="quiet" onPress={onClose} />
  </Page></Modal>;
}
