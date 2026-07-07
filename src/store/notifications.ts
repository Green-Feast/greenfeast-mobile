import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type NotificationAction = 'reload'

export type NotificationEntry = {
  id: string
  title: string
  body: string
  createdAt: string
  read: boolean
  action?: NotificationAction
}

const STORAGE_KEY = 'notification_history_v1'
const MAX_ENTRIES = 50

async function persist(list: NotificationEntry[]) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // best-effort — losing notification history isn't critical
  }
}

interface NotificationState {
  notifications: NotificationEntry[]
  hydrated: boolean
  hydrate: () => Promise<void>
  add: (title: string, body: string, action?: NotificationAction) => Promise<void>
  markAllRead: () => Promise<void>
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)
      set({ notifications: raw ? JSON.parse(raw) : [], hydrated: true })
    } catch {
      set({ hydrated: true })
    }
  },
  add: async (title, body, action) => {
    const entry: NotificationEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      body,
      createdAt: new Date().toISOString(),
      read: false,
      action,
    }
    const next = [entry, ...get().notifications].slice(0, MAX_ENTRIES)
    set({ notifications: next })
    await persist(next)
  },
  markAllRead: async () => {
    const next = get().notifications.map((n) => (n.read ? n : { ...n, read: true }))
    set({ notifications: next })
    await persist(next)
  },
}))
