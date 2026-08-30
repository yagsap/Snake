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

## Step 0 — toolchain (one-time) ⚠️

Your Mac currently has **Xcode 15.4** and **macOS 14 (Sonoma)**. Two issues:

1. **The iOS platform isn't downloaded** — Xcode was installed without it, so
   nothing iOS can build yet.
2. **App Store uploads require a newer SDK than Xcode 15.4 has.**
   <!-- FACTCHECK: exact requirement + date filled in below -->

So, in order:

1. **Update macOS** (System Settings → General → Software Update) to the
   version required by current Xcode — see the requirements table below.
2. **Update Xcode** from the Mac App Store (it is a large download).
3. Open Xcode once and let it install its iOS platform when prompted
   (or run `xcodebuild -downloadPlatform iOS`).

If you want to try the app in the Simulator *before* updating, Xcode 15.4 can
do that much: Xcode → Settings → Platforms → get iOS — but you cannot submit
from 15.4, so updating first is the better use of the download.

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

> Fully offline educational game teaching character recognition for Japanese
> kana, Chinese hanzi, Cyrillic, and Devanagari. No account, no network use.
> Audio: character pronunciations via the system text-to-speech engine.

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

## Requirements table (verified)
<!-- FACTCHECK-TABLE: filled from live sources -->
