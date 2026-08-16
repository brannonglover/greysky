import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';

import { colors } from '@/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.divider,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 84,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.1,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Forecast',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'sparkles' : 'sparkles-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="radar"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'globe' : 'globe-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Notifications',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'cloud' : 'cloud-outline'} size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
