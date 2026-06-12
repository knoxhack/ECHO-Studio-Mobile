import { MD3DarkTheme, type MD3Theme } from 'react-native-paper'
import type { Theme as NavigationTheme } from '@react-navigation/native'

export const echoTheme: MD3Theme = {
  ...MD3DarkTheme,
  roundness: 2,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#41d6c3',
    secondary: '#f2b84b',
    tertiary: '#ff6b8a',
    background: '#071018',
    surface: '#0d1721',
    surfaceVariant: '#142130',
    onSurface: '#edf7f5',
    onSurfaceVariant: '#a8bbc5',
    outline: '#314556',
    error: '#ff6b6b'
  }
}

export const navigationTheme: NavigationTheme = {
  dark: true,
  colors: {
    primary: echoTheme.colors.primary,
    background: echoTheme.colors.background,
    card: '#0b141d',
    text: echoTheme.colors.onSurface,
    border: '#243747',
    notification: echoTheme.colors.tertiary
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '700' },
    heavy: { fontFamily: 'System', fontWeight: '800' }
  }
}
