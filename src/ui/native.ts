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
  /** Diagnostic kill-switch. */
  enabled: true,
  eat(): void {
    if (isNativeApp && this.enabled)
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
  },
  multiplier(): void {
    if (isNativeApp && this.enabled)
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
  },
  wrong(): void {
    if (isNativeApp && this.enabled)
      Haptics.notification({ type: NotificationType.Error }).catch(() => {})
  },
  death(): void {
    if (isNativeApp && this.enabled)
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {})
  },
}

/**
 * Prime AVSpeechSynthesizer with a silent utterance.
 *
 * The native engine was assumed to be free because it renders audio off the
 * webview thread — but profiling the app in the simulator showed the cue
 * blamed for the three longest frames of a run, the worst at 287ms. Loading a
 * voice is main-thread work on this side of the bridge too, so it gets the
 * same treatment as the web engine: pay for it once, up front, in silence.
 */
export function nativeWarmup(lang: LangId): void {
  if (!isNativeApp) return
  nativeSpeak('a', lang, 0)
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
let nativeBusy = false
let nativePending: { text: string; lang: LangId; volume: number } | null = null

function nativeSpeakNow(text: string, lang: LangId, volume: number): void {
  nativeBusy = true
  TextToSpeech.speak({ text, lang: TTS_LANG[lang], rate: 0.9, volume })
    .catch(() => {})
    .then(() => {
      nativeBusy = false
      const next = nativePending
      nativePending = null
      if (next) nativeSpeakNow(next.text, next.lang, next.volume)
    })
}

export function nativeSpeak(text: string, lang: LangId, volume = 1): boolean {
  if (!isNativeApp || !text) return false
  /**
   * COALESCE, never stop-and-restart. The A/B test on a real device was
   * unambiguous: sound off, zero stalls; sound on, stalls — and the plugin
   * source shows why. Its synthesizer runs its own audio session
   * (usesApplicationAudioSession = false), which iOS activates and
   * deactivates around utterances; our stop()-then-speak() per cue forced
   * that transition — a media-server round trip on the app process WKWebView
   * depends on — over and over mid-run. Speaking back-to-back keeps the
   * session churn to natural utterance boundaries, and the newest cue simply
   * replaces any waiting one, so fast eaters still hear the current question.
   */
  if (nativeBusy) {
    nativePending = { text, lang, volume }
    return true
  }
  nativeSpeakNow(text, lang, volume)
  return true
}
