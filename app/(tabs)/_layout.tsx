import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeTabs, Icon, Label, VectorIcon } from 'expo-router/unstable-native-tabs';
import React from 'react';
import { DynamicColorIOS, Platform } from 'react-native';

const tabInk =
  Platform.OS === 'ios'
    ? DynamicColorIOS({ dark: '#FFFFFF', light: '#1C1915' })
    : '#FFFFFF';

export default function TabLayout() {
  return (
    <NativeTabs
      tintColor={tabInk}
      blurEffect="systemThinMaterial"
      backgroundColor="rgba(8, 14, 20, 0.22)"
      disableTransparentOnScrollEdge
      minimizeBehavior="onScrollDown"
      labelVisibilityMode="labeled"
      labelStyle={{
        default: { color: 'rgba(255, 255, 255, 0.72)' },
        selected: { color: tabInk },
      }}
      iconColor={{
        default: 'rgba(255, 255, 255, 0.72)',
        selected: tabInk,
      }}>
      <NativeTabs.Trigger name="index">
        <Label>Forecast</Label>
        <Icon
          sf={{ default: 'sparkles', selected: 'sparkles' }}
          androidSrc={<VectorIcon family={Ionicons} name="sparkles" />}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="radar">
        <Label>Map</Label>
        <Icon
          sf={{ default: 'globe', selected: 'globe.fill' }}
          androidSrc={<VectorIcon family={Ionicons} name="globe-outline" />}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Label>Notifications</Label>
        <Icon
          sf={{ default: 'cloud', selected: 'cloud.fill' }}
          androidSrc={<VectorIcon family={Ionicons} name="cloud-outline" />}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
