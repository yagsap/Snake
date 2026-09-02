import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.yagsap.scriptsnake',
  appName: 'Alphabet Snake',
  webDir: 'dist',
  // Matches --indigo so no white flash ever shows behind the webview.
  backgroundColor: '#1C2541',
  ios: {
    // The page owns its layout via safe-area insets; the webview must not
    // also inset, and must not rubber-band (inner overlays still scroll).
    contentInset: 'never',
    scrollEnabled: false,
  },
}

export default config
