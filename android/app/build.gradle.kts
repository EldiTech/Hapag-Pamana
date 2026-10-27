import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Firebase services — must come after the Android plugin.
    id("com.google.gms.google-services")
}

// The Google Maps key backs the address picker's embedded map. It lives in the
// repo-root .env with every other credential (see .env.example, lib/env.dart)
// rather than inline in AndroidManifest.xml, so it stays out of source control.
//
// A -PGOOGLE_MAPS_API_KEY flag or an environment variable wins over the file,
// so a CI release build can supply the key without a .env on disk.
//
// ⚠ This keeps the key out of *git*, not out of the APK — the manifest still
// ships it, same as before. Restricting the key to this package name and its
// signing SHA-1 in Cloud Console is what actually limits the damage.
val googleMapsApiKey: String = run {
    val supplied = (project.findProperty("GOOGLE_MAPS_API_KEY") as String?)
        ?: System.getenv("GOOGLE_MAPS_API_KEY")
    if (!supplied.isNullOrBlank()) return@run supplied.trim()

    // rootProject here is android/, so this resolves to the repo root.
    val envFile = rootProject.file("../.env")
    if (!envFile.exists()) return@run ""
    val loaded = Properties().apply { envFile.inputStream().use { load(it) } }
    (loaded.getProperty("GOOGLE_MAPS_API_KEY") ?: "").trim().trim('"', '\'')
}

if (googleMapsApiKey.isEmpty()) {
    // A warning rather than a hard failure: everything except the address
    // picker's map builds and runs fine without it, and a fresh checkout has
    // no .env yet.
    logger.warn(
        "GOOGLE_MAPS_API_KEY is missing from .env — the address picker's map " +
            "will render blank. Copy .env.example to .env and fill it in."
    )
}

android {
    namespace = "com.HapagPamana"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Must match the package_name in google-services.json (Firebase registration).
        applicationId = "com.HapagPamana"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        // Substituted into the com.google.android.geo.API_KEY meta-data in
        // AndroidManifest.xml.
        manifestPlaceholders["googleMapsApiKey"] = googleMapsApiKey
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
