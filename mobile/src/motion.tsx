import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform } from 'react-native';

// Remain still until the OS/browser preference is known. One shared listener.
const ReducedMotion = createContext(true);
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    const update = (value: boolean) => { if (active) setReduced(value); };
    void AccessibilityInfo.isReduceMotionEnabled().then(update).catch(() => update(true));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', update);
    return () => { active = false; subscription?.remove(); };
  }, []);
  return <ReducedMotion.Provider value={reduced}>{children}</ReducedMotion.Provider>;
}
export function useEntrance(trigger?: string) {
  const reduced = useContext(ReducedMotion);
  const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    progress.stopAnimation();
    if (reduced) { progress.setValue(1); return; }
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' });
    animation.start(); return () => animation.stop();
  }, [progress, reduced, trigger]);
  return progress;
}
export function usePressScale() {
  const reduced = useContext(ReducedMotion);
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => { if (reduced) { scale.stopAnimation(); scale.setValue(1); } return () => scale.stopAnimation(); }, [reduced, scale]);
  const animate = (pressed: boolean) => {
    scale.stopAnimation();
    if (reduced) { scale.setValue(1); return; }
    Animated.timing(scale, { toValue: pressed ? 0.975 : 1, duration: pressed ? 90 : 140, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
  };
  return { scale, onPressIn: () => animate(true), onPressOut: () => animate(false) };
}
