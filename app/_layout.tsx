import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Appearance, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { colors } from '@/constants/theme';
import { AppProvider } from '@/context/AppContext';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();
Appearance.setColorScheme('dark');

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.divider,
    primary: colors.accent,
  },
};

export default function RootLayout() {
  useEffect(() => {
    Appearance.setColorScheme('dark');
    SplashScreen.hideAsync();
  }, []);

  return (
    <AppProvider>
      <ThemeProvider value={navigationTheme}>
        <View style={styles.root}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
            }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="locations"
              options={{
                presentation: 'modal',
                headerShown: true,
                headerTitle: 'Locations',
                headerTintColor: colors.text,
                headerStyle: { backgroundColor: colors.bg },
                headerTitleStyle: { fontWeight: '600' },
                headerShadowVisible: false,
              }}
            />
          </Stack>
        </View>
      </ThemeProvider>
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
