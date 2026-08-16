import Ionicons from '@expo/vector-icons/Ionicons';
import { PermissionStatus } from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, hairline, pressed, radii, spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { searchPlaces } from '@/lib/weather';

type Result = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
};

const styles = StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    content: {
      padding: spacing.md,
      paddingBottom: 40,
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.bgElevated,
      borderRadius: radii.control,
      borderCurve: 'continuous',
      borderWidth: hairline,
      borderColor: colors.divider,
      paddingHorizontal: 12,
      marginBottom: 20,
    },
    input: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
      paddingVertical: 12,
    },
    section: {
      color: colors.textTertiary,
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 10,
    },
    card: {
      backgroundColor: colors.bgElevated,
      borderRadius: radii.card,
      borderCurve: 'continuous',
      borderWidth: hairline,
      borderColor: colors.divider,
      marginBottom: 24,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: spacing.md,
      borderBottomWidth: hairline,
      borderBottomColor: colors.divider,
    },
    flex: {
      flex: 1,
    },
    name: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: -0.2,
    },
    meta: {
      color: colors.textSecondary,
      marginTop: 3,
      fontSize: 13,
    },
});

export default function LocationsScreen() {
  const router = useRouter();
  const {
    savedLocations,
    selectedId,
    permission,
    selectCurrentLocation,
    selectSavedLocation,
    addSavedLocation,
    removeSavedLocation,
  } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onSearch(text: string) {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const next = await searchPlaces(text);
      setResults(next);
      setSearching(false);
    }, 280);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={onSearch}
          placeholder="Search cities"
          placeholderTextColor={colors.textTertiary}
          autoCorrect={false}
          style={styles.input}
        />
        {searching ? <ActivityIndicator color={colors.accent} /> : null}
      </View>

      {results.length > 0 ? (
        <View style={styles.card}>
          {results.map((item) => {
            const subtitle = [item.admin1, item.country].filter(Boolean).join(', ');
            return (
              <Pressable
                key={item.id}
                style={({ pressed: isPressed }) => [styles.row, isPressed && pressed]}
                onPress={async () => {
                  await addSavedLocation({
                    name: item.name,
                    subtitle,
                    latitude: item.latitude,
                    longitude: item.longitude,
                  });
                  router.back();
                }}>
                <View>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>{subtitle}</Text>
                </View>
                <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.section}>Saved</Text>
      <View style={styles.card}>
        <Pressable
          style={({ pressed: isPressed }) => [styles.row, isPressed && pressed]}
          onPress={async () => {
            if (permission !== PermissionStatus.GRANTED) {
              router.back();
              return;
            }
            await selectCurrentLocation();
            router.back();
          }}>
          <View>
            <Text style={styles.name}>Current location</Text>
            <Text style={styles.meta}>Hyperlocal GPS nowcast</Text>
          </View>
          {selectedId === 'current' ? <Ionicons name="checkmark" size={20} color={colors.precip} /> : null}
        </Pressable>
        {savedLocations.map((location) => (
          <View key={location.id} style={styles.row}>
            <Pressable
              style={({ pressed: isPressed }) => [styles.flex, isPressed && pressed]}
              onPress={async () => {
                await selectSavedLocation(location);
                router.back();
              }}>
              <Text style={styles.name}>{location.name}</Text>
              {location.subtitle ? <Text style={styles.meta}>{location.subtitle}</Text> : null}
            </Pressable>
            {selectedId === location.id ? <Ionicons name="checkmark" size={20} color={colors.precip} /> : null}
            <Pressable
              onPress={() => removeSavedLocation(location.id)}
              hitSlop={10}
              style={({ pressed: isPressed }) => isPressed && pressed}>
              <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
