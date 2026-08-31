# Shipping Script Snake to the iOS App Store

The iOS app is a Capacitor 8 shell around the same web build that deploys to
GitHub Pages. One codebase; `dist/` is copied into the app bundle, so the game
is fully offline on device. This guide is the path from this repo to the store.

## What's already done

- `ios/App/App.xcodeproj` — the Xcode project (Swift Package Manager, no
  CocoaPods needed). Bundle id `com.yagsap.scriptsnake`, portrait-only,
  iPhone-family. App icon + launch splash generated from `assets/`.
- Native integration: haptics on eat/wrong/death, native text-to-speech
  fallback if the webview has no voice for a language, dark status bar,
  safe-area layout, no rubber-band scrolling.
- `ITSAppUsesNonExemptEncryption = NO` is set in Info.plist, so you will not
  be asked the export-compliance question on every upload.
- Privacy policy page: https://yagsap.github.io/Snake/privacy.html
  (deployed with the site; App Store Connect requires this URL).
- Version `1.0`, build `1`, deployment target iOS 15, automatic signing.
  The only unset field is the signing **Team**, which is yours to pick.

Content, for the store listing: **seven writing systems** — English, Japanese
(hiragana, katakana, and the voiced rows), Chinese (HSK-1 hanzi), Russian,
Hindi, Korean (jamo and syllables) and Greek — across **130 campaign levels**,
plus endless play and a daily seeded challenge.

## Step 0 — toolchain ✅ done

This was the long pole and it is cleared. As of 2026-08-31 the Mac runs
**macOS 26** with **Xcode 26.6 (build 17F113)** and the **iOS 26.5 SDK**, which
is what Apple has required for uploads since 2026-04-28 and what Capacitor 8
requires to build at all. The Xcode licence is accepted (`sudo xcodebuild
-license accept`) — until it was, even `git` refused to run, since the only
`git` on this machine is Xcode's.

**Verified, not assumed**: `xcodebuild` compiles every Swift target — Capacitor
8.5.0, the Haptics, StatusBar and TextToSpeech plugins, and the app itself —
against the iOS 26.5 SDK, with Swift Package Manager resolving cleanly and no
CocoaPods anywhere.

The one remaining piece is the iOS **platform support package** (device symbols
+ Simulator runtime, ~7 GB), without which storyboard compilation fails with
`iOS 26.5 Platform Not Installed`:

```bash
xcodebuild -downloadPlatform iOS      # or: Xcode → Settings → Components
```

## Step 1 — run it locally

```bash
npm run build && npx cap sync ios   # after ANY web change, always
npx cap open ios                    # opens the project in Xcode
```

In Xcode: pick a simulator (or your plugged-in iPhone) in the toolbar and
press ▶. First run on a real device: Settings → General → VPN & Device
Management → trust your developer certificate.

## Step 2 — signing

Project navigator → **App** target → **Signing & Capabilities**:

- Check **Automatically manage signing**.
- **Team**: select your Apple Developer account team.
- If the bundle id collides with someone else's, change it here (reverse-DNS,
  e.g. `com.yourname.scriptsnake`) — then use the same id in App Store Connect.

Note: distribution requires the **paid** Apple Developer Program ($99/yr),
not just an Apple ID. Check your enrollment at https://developer.apple.com/account
— it should say "Apple Developer Program" membership, active.

## Step 3 — App Store Connect record

At https://appstoreconnect.apple.com → My Apps → **+** → New App:

| Field | Value |
|---|---|
| Platform | iOS |
| Name | Script Snake (if taken, e.g. "Script Snake — learn kana & more") |
| Primary language | English |
| Bundle ID | the one from Step 2 |
| SKU | `scriptsnake-001` (internal, never shown) |

Then fill in:

- **Privacy Policy URL**: `https://yagsap.github.io/Snake/privacy.html`
- **App Privacy** → Get Started → **"Data Not Collected"** (true: everything
  is localStorage on device, no analytics, no network calls).
- **Age rating**: answer the questionnaire honestly — everything "No" → 4+.
- **Category**: Education (secondary: Games → Word or Puzzle).
- **Pricing**: Free (or your choice).

## Step 4 — screenshots

Run the app in the Simulator on the largest iPhone, then **⌘S** saves a
screenshot to the Desktop. Take 3–5: the menu, mid-run with the snake carrying
characters, the study chart, the game-over card. Requirements as of this
writing are in the table below — one modern size is enough; App Store Connect
scales it for smaller devices.

## Step 5 — archive and upload

1. Xcode toolbar: destination **Any iOS Device (arm64)**.
2. **Product → Archive**.
3. Organizer opens → **Distribute App** → **App Store Connect** → Upload →
   defaults all the way.
4. In App Store Connect the build appears under TestFlight in ~15 minutes
   (first build may take longer + an email about processing).

**Recommended**: TestFlight it to your own phone first (TestFlight tab →
Internal Testing → add yourself) and play a few runs before submitting.

## Step 6 — submit for review

App Store Connect → your app → the version page → select the build →
**Add for Review** → **Submit**. In *App Review Information*, add a note:

> Fully offline educational game teaching character recognition across seven
> writing systems: the English alphabet, Japanese kana, Chinese hanzi,
> Cyrillic, Devanagari, Hangul and Greek. No account, no network use, no data
> collected. Audio: character pronunciations via the system text-to-speech
> engine (AVSpeechSynthesizer).

Typical review time is 1–2 days. Common first-app rejections and their
answers, should they come up:

- **Guideline 4.2 (minimum functionality)** — the app is a complete offline
  game with native haptics and speech, not a repackaged website; say so in
  the resolution note if asked. Never load the game from a remote URL.
- **Guideline 2.3 (accurate metadata)** — make screenshots from the real app.

## Ongoing updates

```bash
# web change → new app build:
npm run build && npx cap sync ios
# bump the version in Xcode (App target → General → Version/Build),
# then Product → Archive → upload again.
```

The web deploy (GitHub Pages) and the app share `src/`; pushing to `main`
updates the website automatically, while the app updates only when you
archive and upload.

## Requirements table

Verified 2026-08-31 against developer.apple.com and capacitorjs.com:

| Requirement | Value | Source |
|---|---|---|
| SDK required for App Store uploads | Xcode 26+ / iOS 26 SDK, since **April 28, 2026** | developer.apple.com/news/upcoming-requirements |
| macOS for Xcode 26.0–26.3 | Sequoia 15.6+ | developer.apple.com/support/xcode |
| macOS for latest Xcode (26.4+) | Tahoe 26.2+ | developer.apple.com/support/xcode |
| Capacitor 8 build requirement | Xcode 26.0+, SPM fully supported | capacitorjs.com "Updating to 8.0" |
| iPhone screenshots | ONE 6.9-inch set suffices (1320×2868 portrait, up to 10 shots); smaller sizes auto-scale from it | App Store Connect Help, screenshot specifications |
| Privacy policy URL | Mandatory for every app, even with zero data collection | developer.apple.com/app-store/app-privacy-details |
| App Privacy questionnaire | Answer "No, we do not collect data" → done; on-device localStorage does not count as collection | App Store Connect Help, manage app privacy |
| Export compliance | Pre-answered via `ITSAppUsesNonExemptEncryption=NO` in Info.plist | already configured |

A note on review: apps built with the iOS 26 SDK adopt Apple's current native
UI appearance by default — irrelevant here, since the game draws its own UI
inside the webview.
