import Flutter
import GoogleMaps
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Google Maps SDK — backs the address picker's embedded map
    // (lib/screens/user/address_picker_page.dart). The key is read from the
    // bundled .env rather than typed here, so it stays out of source control
    // alongside every other credential (see .env.example, lib/env.dart).
    //
    // ⚠ This keeps the key out of *git*, not out of the .ipa — .env ships as
    // an app asset either way. Restricting the key to this bundle id in Cloud
    // Console is what actually limits the damage.
    if let key = AppDelegate.envValue(for: "GOOGLE_MAPS_API_KEY"), !key.isEmpty {
      GMSServices.provideAPIKey(key)
    } else {
      NSLog(
        "[HapagPamana] GOOGLE_MAPS_API_KEY missing from .env — the address "
          + "picker's map will render blank.")
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  /// Reads one key out of the `.env` Flutter asset.
  ///
  /// Dart reads the same file through `flutter_dotenv` (see `lib/env.dart`),
  /// but the Maps SDK has to be keyed before the Flutter engine starts, so
  /// there is no Dart to ask yet — the asset is parsed directly instead.
  private static func envValue(for name: String) -> String? {
    let assetKey = FlutterDartProject.lookupKey(forAsset: ".env")
    guard let path = Bundle.main.path(forResource: assetKey, ofType: nil),
      let contents = try? String(contentsOfFile: path, encoding: .utf8)
    else { return nil }

    for line in contents.split(whereSeparator: \.isNewline) {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      guard !trimmed.hasPrefix("#"), let separator = trimmed.firstIndex(of: "=") else { continue }
      guard trimmed[..<separator].trimmingCharacters(in: .whitespaces) == name else { continue }
      return trimmed[trimmed.index(after: separator)...]
        .trimmingCharacters(in: .whitespaces)
        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
    }
    return nil
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}
