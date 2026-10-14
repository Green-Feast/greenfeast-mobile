import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'

export type NotificationAction = 'reload'

export type NotificationEntry = {
  id: string
  title: string
  body: string
  createdAt: string
  read: boolean
  action?: NotificationAction
}

// Two sources, shown as one list under the bell:
// - local: things only this device knows (an app update downloaded /
//   installed), kept in AsyncStorage;
// - remote: every message GreenFeast sent this customer (delivery status,
//   skips, low wallet, refunds, cash received, promotions…) — the
//   `notifications` table, which every push also writes a row to.
const STORAGE_KEY = 'notification_history_v1'
const MAX_ENTRIES = 50
const REMOTE_LIMIT = 50

async function persist(list: NotificationEntry[]) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // best-effort — losing notification history isn't critical
  }
}

interface NotificationState {
  local: NotificationEntry[]
  remote: NotificationEntry[]
  hydrated: boolean
  hydrate: () => Promise<void>
  add: (title: string, body: string, action?: NotificationAction) => Promise<void>
  loadRemote: (userId: string) => Promise<void>
  clearRemote: () => void
  markAllRead: (userId?: string | null) => Promise<void>
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  local: [],
  remote: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)
      set({ local: raw ? JSON.parse(raw) : [], hydrated: true })
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
    const next = [entry, ...get().local].slice(0, MAX_ENTRIES)
    set({ local: next })
    await persist(next)
  },
  loadRemote: async (userId) => {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, title, body, read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(REMOTE_LIMIT)
    if (error) return // keep what's shown on a flaky connection
    set({
      remote: ((data ?? []) as { id: string; title: string; body: string; read: boolean | null; created_at: string }[])
        .map((n) => ({ id: n.id, title: n.title, body: n.body, read: !!n.read, createdAt: n.created_at })),
    })
  },
  clearRemote: () => set({ remote: [] }),
  markAllRead: async (userId) => {
    const local = get().local.map((n) => (n.read ? n : { ...n, read: true }))
    const hadUnreadRemote = get().remote.some((n) => !n.read)
    set({ local, remote: get().remote.map((n) => (n.read ? n : { ...n, read: true })) })
    await persist(local)
    if (userId && hadUnreadRemote) {
      await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
    }
  },
}))

// Newest first, both sources together.
export function mergedNotifications(local: NotificationEntry[], remote: NotificationEntry[]) {
  return [...local, ...remote].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}
