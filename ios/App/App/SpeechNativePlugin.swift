import AVFoundation
import Capacitor

/**
 * The game's own speech bridge, written because every off-the-shelf path
 * stalled the webview. An on-device A/B (sound toggles in the diag overlay)
 * proved speech utterances were the stalls; reading the stock plugin showed
 * why: a private audio session activated and deactivated around every
 * utterance — a media-server round trip on the app process WKWebView needs
 * for compositing. The webview's own speechSynthesis was better but still
 * paid a per-utterance transition.
 *
 * This plugin removes the mechanism instead of rationing it:
 *  - ONE audio session, configured `.playback` + `.mixWithOthers`, activated
 *    at launch and never deactivated. Utterances stop transitioning anything.
 *  - The synthesizer joins that session (`usesApplicationAudioSession=true`).
 *  - Every call runs on a dedicated queue, so the main thread does nothing.
 *  - Voices resolve once per language, not once per utterance.
 */
@objc(SpeechNativePlugin)
public class SpeechNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpeechNativePlugin"
    public let jsName = "SpeechNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let synth = AVSpeechSynthesizer()
    private var voices: [String: AVSpeechSynthesisVoice] = [:]
    private let work = DispatchQueue(label: "game.speech", qos: .userInitiated)

    override public func load() {
        synth.usesApplicationAudioSession = true
        work.async {
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try? session.setActive(true)
        }
    }

    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let lang = call.getString("lang") ?? "en-US"
        let rate = call.getFloat("rate") ?? 1.0
        let volume = call.getFloat("volume") ?? 1.0
        // Resolve immediately: the caller is a game loop, not a dialogue
        // system, and must never wait on audio.
        call.resolve()
        guard !text.isEmpty else { return }
        work.async { [self] in
            if synth.isSpeaking {
                synth.stopSpeaking(at: .immediate)
            }
            let u = AVSpeechUtterance(string: text)
            if voices[lang] == nil {
                voices[lang] = AVSpeechSynthesisVoice(language: lang)
            }
            u.voice = voices[lang]
            u.rate = AVSpeechUtteranceDefaultSpeechRate * rate
            u.volume = volume
            synth.speak(u)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        call.resolve()
        work.async { [self] in
            synth.stopSpeaking(at: .immediate)
        }
    }
}
