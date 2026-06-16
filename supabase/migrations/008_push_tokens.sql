-- Migration 008: Expo push token storage on users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS expo_push_token TEXT;
