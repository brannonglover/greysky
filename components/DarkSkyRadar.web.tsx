import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/constants/theme';
import {
  buildRadarHtml,
  parseRadarMessage,
  type RadarCommand,
  type RadarHtmlFrame,
} from '@/lib/radarHtml';

export type { RadarHtmlFrame as RadarViewFrame };

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

type IframeWindow = {
  postMessage: (message: string, targetOrigin: string) => void;
};

type IframeElement = {
  contentWindow: IframeWindow | null;
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
  const iframeRef = useRef<IframeElement | null>(null);
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
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify(command), '*');
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

  useEffect(() => {
    const onWindowMessage = (event: { data?: unknown; source?: unknown }) => {
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
      if (typeof event.data !== 'string') return;
      handleRawMessage(event.data);
    };
    window.addEventListener('message', onWindowMessage);
    return () => window.removeEventListener('message', onWindowMessage);
  }, [handleRawMessage]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.mapBg }, style]}>
      {React.createElement('iframe', {
        ref: iframeRef,
        srcDoc: html,
        onLoad: () => setReady(true),
        sandbox: 'allow-scripts allow-same-origin',
        title: 'Radar',
        style: {
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          backgroundColor: colors.mapBg,
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    overflow: 'hidden',
  },
});
