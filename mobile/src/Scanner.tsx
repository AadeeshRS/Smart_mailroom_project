import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Platform, View } from 'react-native';
import { Button, Card, Heading, Muted, Notice, Page } from './ui';

/** Only decoded barcode text is returned. No OCR, identity inference, or auto-submission. */
export function Scanner({
  open,
  onClose,
  onScan,
  title = 'Scan a parcel label',
  notice = 'Point the camera at the AWB or order-ID barcode. You type the name and phone from the label next.',
}: {
  open: boolean;
  onClose: () => void;
  onScan: (text: string) => void;
  title?: string;
  notice?: string;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const focused = useIsFocused();
  const visible = useRef(false);
  visible.current = open && focused;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [scanned, setScanned] = useState(false);
  const scanLock = useRef(false);
  useEffect(() => {
    if (!open || !focused) return;
    let active = true;
    setScanned(false);
    scanLock.current = false;
    setError('');
    setAvailable(null);
    if (Platform.OS === 'web')
      CameraView.isAvailableAsync()
        .then(value => {
          if (active) setAvailable(value);
        })
        .catch(() => {
          if (active) {
            setAvailable(false);
            setError('Camera could not be initialized.');
          }
        });
    else setAvailable(true);
    return () => {
      active = false;
    };
  }, [open, focused]);
  async function ask() {
    try {
      const result = await requestPermission();
      if (!result.granted)
        setError(
          'Camera access was denied or unavailable. Use manual entry, or enable camera access in device/browser settings.',
        );
    } catch {
      setError('Camera permission could not be requested. Use manual entry.');
    }
  }
  if (!open || !focused) return null; // Release the physical camera, rather than hiding an active preview.
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <Page
        modal
        title={title}
        subtitle="Camera scanning requires a supported device and camera permission."
        back={onClose}
      >
        <Notice>{notice}</Notice>
        {!!error && <Notice danger>{error}</Notice>}
        {available === false ? (
          <Card>
            <Heading>Camera unavailable</Heading>
            <Muted>Use a supported physical device, or return to manual entry.</Muted>
          </Card>
        ) : !permission?.granted ? (
          <Card>
            <Heading>Camera permission needed</Heading>
            <Muted>
              {permission?.canAskAgain === false
                ? 'Permission was denied. Enable camera access in device or browser settings, or use manual entry.'
                : 'Allow camera access to scan. No photos or video are saved.'}
            </Muted>
            {permission?.canAskAgain !== false ? (
              <Button label="Allow camera access" onPress={ask} />
            ) : Platform.OS !== 'web' ? (
              <Button
                label="Open device settings"
                onPress={() => {
                  Linking.openSettings().catch(() =>
                    setError('Open device settings manually to enable camera access.'),
                  );
                }}
              />
            ) : null}
          </Card>
        ) : available ? (
          <View
            accessible
            accessibilityLabel="Camera viewfinder. Point it at the barcode; it scans on its own."
            style={{ height: 340, borderRadius: 18, overflow: 'hidden' }}
          >
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8', 'pdf417', 'datamatrix', 'upc_a', 'upc_e'],
              }}
              onMountError={() => {
                setError('Camera preview failed. Return to manual entry or try another supported device.');
                setAvailable(false);
              }}
              onBarcodeScanned={
                scanned
                  ? undefined
                  : result => {
                      if (!visible.current || scanLock.current) return;
                      scanLock.current = true;
                      setScanned(true);
                      onScan(result.data);
                      onClose();
                    }
              }
            />
          </View>
        ) : (
          <Muted>Checking camera availability…</Muted>
        )}
        <Button label="Type the code instead" variant="quiet" onPress={onClose} />
      </Page>
    </Modal>
  );
}
