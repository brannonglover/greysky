import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeTabs, Badge, Icon, Label, VectorIcon } from 'expo-router/unstable-native-tabs';
import React, { useMemo } from 'react';
import { DynamicColorIOS, Platform } from 'react-native';

import { useApp } from '@/context/AppContext';
import { rankStormItems } from '@/lib/stormImpact';
import { forecastStormSignals } from '@/lib/stormOutlook';

const tabInk =
  Platform.OS === 'ios'
    ? DynamicColorIOS({ dark: '#FFFFFF', light: '#1C1915' })
    : '#FFFFFF';

export default function TabLayout() {
  const { weather, tropical, outlooks, regional } = useApp();

  // The Storms tab grows more prominent as the threat does. Only an official
  // alert already in effect earns the badge — an outlook days out is worth
  // reading, not worth marking the tab.
  const activeCount = useMemo(() => {
    if (!weather) return 0;
    return rankStormItems({
      alerts: weather.alerts,
      signals: forecastStormSignals(weather),
      tropical,
      outlooks,
      regional,
    }).filter((item) => item.tier === 'active').length;
  }, [weather, tropical, outlooks, regional]);

  return (
    <NativeTabs
      tintColor={tabInk}
      minimizeBehavior="never"
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
      <NativeTabs.Trigger name="storms">
        <Label>Storms</Label>
        <Icon
          sf={{ default: 'hurricane', selected: 'hurricane' }}
          androidSrc={<VectorIcon family={Ionicons} name="thunderstorm-outline" />}
        />
        <Badge hidden={activeCount === 0}>{activeCount > 0 ? String(activeCount) : ''}</Badge>
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
          sf={{ default: 'bell', selected: 'bell.fill' }}
          androidSrc={<VectorIcon family={Ionicons} name="notifications-outline" />}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
