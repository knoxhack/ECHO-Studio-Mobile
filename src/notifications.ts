import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { MobileSettings } from './mobileTypes'

const CHANNEL_ID = 'echo-studio-mobile'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
})

export async function ensureNotificationPermissions(settings: MobileSettings): Promise<boolean> {
  if (!settings.notificationsEnabled) return false
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'ECHO Studio Mobile',
      importance: Notifications.AndroidImportance.DEFAULT
    })
  }
  const existing = await Notifications.getPermissionsAsync()
  if (existing.granted) return true
  const requested = await Notifications.requestPermissionsAsync()
  return requested.granted
}

export async function notifyStudio(settings: MobileSettings, title: string, body: string): Promise<void> {
  const allowed = await ensureNotificationPermissions(settings)
  if (!allowed) return
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null
  })
}
