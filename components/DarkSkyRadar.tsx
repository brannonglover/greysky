import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { WebView as NativeWebView } from 'react-native-webview';

import { colors } from '@/constants/theme';
import {
  buildRadarHtml,
  parseRadarMessage,
  type RadarCommand,
  type RadarHtmlFrame,
} from '@/lib/radarHtml';

export type { RadarHtmlFrame as RadarViewFrame };

function loadNativeWebView(): typeof NativeWebView | null {
  try {
    return require('react-native-webview').WebView as typeof NativeWebView;
  } catch {
    return null;
  }
}

const WebView = loadNativeWebView();

type Props = {
  latitude: number;
  longitude: number;
  zoom?: number;
  frames: RadarHtmlFrame[];
  playing?: boolean;
  index?: number;
  onIndexChange?: (index: number) => void;
  scrollEnabled?: boolean;
  intervalMs?: number;
  style?: StyleProp<ViewStyle>;
};

export function DarkSkyRadar({
  latitude,
  longitude,
  zoom = 6,
  frames,
  playing = true,
  index = 0,
  onIndexChange,
  scrollEnabled = true,
  intervalMs = 700,
  style,
}: Props) {
  const webViewRef = useRef<NativeWebView>(null);
  const indexFromWeb = useRef(index);
  const indexRef = useRef(index);
  const [ready, setReady] = useState(false);
  indexRef.current = index;

  const html = useMemo(
    () =>
      buildRadarHtml({
        lat: latitude,
        lng: longitude,
        zoom,
        frames: [],
        playing: false,
        index: 0,
        intervalMs,
        interactive: scrollEnabled,
      }),
    [latitude, longitude, zoom, intervalMs, scrollEnabled],
  );

  useEffect(() => {
    setReady(false);
  }, [html]);

  const send = useCallback((command: RadarCommand) => {
    const js = `window.applyRadarCommand && window.applyRadarCommand(${JSON.stringify(command)}); true;`;
    webViewRef.current?.injectJavaScript(js);
  }, []);

  useEffect(() => {
    if (!ready) return;
    send({ type: 'setFrames', frames, index: indexRef.current });
  }, [frames, ready, send]);

  useEffect(() => {
    if (!ready) return;
    send({ type: 'setPlaying', playing });
  }, [playing, ready, send]);

  useEffect(() => {
    if (!ready) return;
    if (index !== indexFromWeb.current) {
      indexFromWeb.current = index;
      send({ type: 'seek', index });
    }
  }, [index, ready, send]);

  const handleRawMessage = useCallback(
    (raw: string) => {
      const message = parseRadarMessage(raw);
      if (!message) return;
      if (message.type === 'ready') {
        setReady(true);
      }
      if (message.type === 'index' && typeof message.index === 'number') {
        indexFromWeb.current = message.index;
        onIndexChange?.(message.index);
      }
    },
    [onIndexChange],
  );

  const fill = [styles.fill, { backgroundColor: colors.mapBg }, style];

  if (!WebView) {
    return <View style={fill} />;
  }

  return (
    <View style={fill}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://unpkg.com' }}
        containerStyle={[styles.fill, { backgroundColor: colors.mapBg }]}
        style={[styles.fill, { backgroundColor: colors.mapBg }]}
        scrollEnabled={scrollEnabled}
        nestedScrollEnabled={scrollEnabled}
        javaScriptEnabled
        domStorageEnabled
        automaticallyAdjustContentInsets={false}
        setBuiltInZoomControls={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        bounces={false}
        onLoadEnd={() => setReady(true)}
        onMessage={(event) => handleRawMessage(event.nativeEvent.data)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    overflow: 'hidden',
  },
});
