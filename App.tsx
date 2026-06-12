import 'react-native-gesture-handler'
import { useEffect } from 'react'
import { View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, PaperProvider, Snackbar, Text } from 'react-native-paper'
import { Bot, CloudCog, FolderKanban, Home, PenTool, Settings } from 'lucide-react-native'
import { AIScreen, BuildScreen, ContentScreen, CreateScreen, HomeScreen, SettingsScreen } from './src/screens'
import { echoTheme, navigationTheme } from './src/theme'
import { useStudioStore } from './src/storage'

type TabParamList = {
  Home: undefined
  Create: undefined
  Content: undefined
  Build: undefined
  AI: undefined
  Settings: undefined
}

const Tab = createBottomTabNavigator<TabParamList>()
const queryClient = new QueryClient()

function BootGate() {
  const hydrated = useStudioStore((state) => state.hydrated)
  const hydrate = useStudioStore((state) => state.hydrate)
  const toast = useStudioStore((state) => state.toast)
  const setToast = useStudioStore((state) => state.setToast)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: echoTheme.colors.background }}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 12 }}>Loading ECHO Studio Mobile</Text>
      </View>
    )
  }

  return (
    <>
      <NavigationContainer theme={navigationTheme}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: '#0b141d',
              borderTopColor: '#243747'
            },
            tabBarActiveTintColor: echoTheme.colors.primary,
            tabBarInactiveTintColor: '#8ea3b1'
          }}
        >
          <Tab.Screen
            name="Home"
            component={HomeScreen}
            options={{ tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }}
          />
          <Tab.Screen
            name="Create"
            component={CreateScreen}
            options={{ tabBarIcon: ({ color, size }) => <PenTool color={color} size={size} /> }}
          />
          <Tab.Screen
            name="Content"
            component={ContentScreen}
            options={{ tabBarIcon: ({ color, size }) => <FolderKanban color={color} size={size} /> }}
          />
          <Tab.Screen
            name="Build"
            component={BuildScreen}
            options={{ tabBarIcon: ({ color, size }) => <CloudCog color={color} size={size} /> }}
          />
          <Tab.Screen
            name="AI"
            component={AIScreen}
            options={{ tabBarIcon: ({ color, size }) => <Bot color={color} size={size} /> }}
          />
          <Tab.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }}
          />
        </Tab.Navigator>
      </NavigationContainer>
      <Snackbar visible={Boolean(toast)} onDismiss={() => setToast('')} duration={4500}>
        {toast}
      </Snackbar>
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PaperProvider theme={echoTheme}>
        <BootGate />
        <StatusBar style="light" />
      </PaperProvider>
    </QueryClientProvider>
  )
}
