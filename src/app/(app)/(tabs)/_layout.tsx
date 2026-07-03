import { Tabs } from 'expo-router'
import { Home, BookOpen, UtensilsCrossed, User, Sparkles } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Fonts } from '@/constants/colors'
import { useAuthStore } from '@/store/auth'
import TabBarButton from '@/components/TabBarButton'

export default function TabsLayout() {
  const hasSubscription = useAuthStore((s) => s.hasSubscription)
  const insets = useSafeAreaInsets()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Hide the bar while the keyboard is open and kill the platform
        // elevation/shadow so no grey box artifact lingers after it closes.
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: Colors.green700,
        tabBarInactiveTintColor: Colors.ink400,
        tabBarButton: TabBarButton,
        tabBarStyle: {
          backgroundColor: Colors.cream50,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          // Base 64px content height + whatever the system nav bar/home
          // indicator needs (insets.bottom is ~0 on gesture nav, ~48dp on
          // 3-button nav) — otherwise the tab bar sits underneath it.
          height: 64 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 8 + insets.bottom,
          elevation: 0,
          shadowColor: 'transparent',
          shadowOpacity: 0,
        },
        tabBarLabelStyle: {
          fontFamily: Fonts.bodyMed,
          fontSize: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Home size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="subscription"
        options={{
          // Subscribers see "My Plan" (book); non-subscribers see a gold
          // "Subscribe" star. Label keeps the default green/gray tint — only
          // the icon is gold so it draws the eye without looking "red".
          title: hasSubscription ? 'My Plan' : 'Subscribe',
          tabBarIcon: ({ color, focused }) =>
            hasSubscription ? (
              <BookOpen size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
            ) : (
              <Sparkles size={22} color={Colors.accent} strokeWidth={2.2} fill={Colors.accent} />
            ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menu',
          tabBarIcon: ({ color, focused }) => (
            <UtensilsCrossed size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, focused }) => (
            <User size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
          ),
        }}
      />
    </Tabs>
  )
}
