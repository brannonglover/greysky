import { LinearGradient } from 'expo-linear-gradient';
import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, scrim } from '@/constants/theme';
import { useApp } from '@/context/AppContext';

type Props = {
  children?: ReactNode;
};

export function SkyBackdrop({ children }: Props) {
  const { sky } = useApp();

  return (
    <View style={styles.fill}>
      <LinearGradient
        colors={sky.gradient}
        locations={sky.locations}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={scrim.colors}
        locations={scrim.locations}
        pointerEvents="none"
        style={styles.scrim}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '56%',
  },
});
