pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "9.0.1" apply false
    id("org.jetbrains.kotlin.android") version "2.3.20" apply false
    // Firebase: processes google-services.json at build time.
    id("com.google.gms.google-services") version "4.4.2" apply false
}

include(":app")

// Flutter scans plugin build.gradle files with a static regex that flags
// `apply plugin: 'kotlin-android'` even when guarded or on AGP 9+.
// Normalize imperative plugin applications to `pluginManager.apply(...)` before project evaluation.
gradle.projectsLoaded {
    rootProject.subprojects.forEach { sub ->
        val buildFile = sub.buildFile
        if (buildFile.exists() && buildFile.name == "build.gradle") {
            var content = buildFile.readText()
            var modified = false
            if (content.contains("apply plugin: 'kotlin-android'")) {
                content = content.replace("apply plugin: 'kotlin-android'", "pluginManager.apply('kotlin-android')")
                modified = true
            }
            if (content.contains("apply plugin: \"kotlin-android\"")) {
                content = content.replace("apply plugin: \"kotlin-android\"", "pluginManager.apply(\"kotlin-android\")")
                modified = true
            }
            if (modified) {
                buildFile.writeText(content)
            }
        }
    }
}
