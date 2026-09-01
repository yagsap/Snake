import Capacitor
import UIKit

/**
 * The bridge view controller, subclassed only to register the app-local
 * speech plugin — Capacitor auto-discovers packaged plugins but not ones
 * that live inside the app target.
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SpeechNativePlugin())
    }
}
