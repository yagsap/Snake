import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { StatusBar, Style } from '@capacitor/status-bar'
import { TextToSpeech } from '@capacitor-community/text-to-speech'
import type { LangId } from '../data/scripts'

/**
 * The only file that knows the game sometimes runs inside a Capacitor shell.
 *
 * Everything is guarded by `isNativeApp` and fails silent: the same bundle
 * serves the web page and the iOS app, and the web build must not change
 * behaviour by a single frame because these plugins exist. Every call is
 * fire-and-forget — haptics and speech are garnish, never worth an exception
 * reaching the game loop.
 */

export const isNativeApp = Capacitor.isNativePlatform()

/** BCP-47 tags for the native synthesizer (AVSpeechSynthesizer on iOS). */
const TTS_LANG: Record<LangId, string> = {
  en: 'en-US',
  ja: 'ja-JP',
  zh: 'zh-CN',
  ru: 'ru-RU',
  hi: 'hi-IN',
  ko: 'ko-KR',
  el: 'el-GR',
}

/** One-time app-shell chrome setup. Call at bootstrap. */
export function initNativeChrome(): void {
  if (!isNativeApp) return
  // Style.Dark = light glyphs — our background is deep indigo.
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
}

/**
 * Haptic vocabulary, named by game event rather than by UIKit constant so the
 * call sites read as intent. Mirrors the audio design: light for routine
 * success, distinct notification for mistakes, heavy for death.
 */
export const haptic = {
  eat(): void {
    if (isNativeApp) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
  },
  multiplier(): void {
    if (isNativeApp) Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
  },
  wrong(): void {
    if (isNativeApp)
      Haptics.notification({ type: NotificationType.Error }).catch(() => {})
  },
  death(): void {
    if (isNativeApp) Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {})
  },
}

/**
 * Native text-to-speech fallback.
 *
 * WKWebView's window.speechSynthesis has a history of shipping with an empty
 * voice list on some iOS releases. When the web path has no voice for the
 * language, this speaks through AVSpeechSynthesizer instead — the cue is the
 * entire game, so it gets a second engine. Returns false when unavailable so
 * the caller knows the cue stayed silent.
 */
export function nativeSpeak(text: string, lang: LangId): boolean {
  if (!isNativeApp || !text) return false
  void TextToSpeech.stop()
    .catch(() => {})
    .then(() =>
      TextToSpeech.speak({ text, lang: TTS_LANG[lang], rate: 0.9 }).catch(
        () => {},
      ),
    )
  return true
}
