import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

/**
 * AGP writes resources with COPY_ATTRIBUTES (and Gradle needs chmod for its
 * daemon registry). A few sandbox workspaces live on FUSE mounts that reject
 * those operations. Detect that once, and keep build outputs on the local
 * filesystem while mirroring the APK back to the conventional path.
 */
fun preservesFileAttributes(dir: File): Boolean {
    val source = File(dir, ".phonedek-attr-probe")
    val target = File(dir, ".phonedek-attr-probe-copy")
    return try {
        dir.mkdirs()
        source.writeText("probe")
        Files.copy(source.toPath(), target.toPath(), StandardCopyOption.COPY_ATTRIBUTES)
        true
    } catch (_: Throwable) {
        false
    } finally {
        source.delete()
        target.delete()
    }
}

val projectBuildDir = layout.buildDirectory.get().asFile
val useExternalBuildDir = !preservesFileAttributes(projectBuildDir)
if (useExternalBuildDir) {
    val external = File(System.getProperty("user.home"), ".cache/phonedek/android-build")
    layout.buildDirectory.set(external)
    logger.lifecycle(
        "PhoneDeck: project filesystem rejects file attributes; building in ${external.absolutePath}",
    )
}

android {
    namespace = "com.phonedek.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.phonedek.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 17
        versionName = "0.4.0"
    }

    signingConfigs {
        getByName("debug") {
            // Stable debug key committed on purpose. Debug keys are not secrets,
            // and using one key means CI APKs can update each other.
            storeFile = rootProject.file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.coil-kt:coil-gif:2.7.0")
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
}

if (useExternalBuildDir) {
    val mirrorRoot = projectBuildDir
    val mirrorDebugApk = tasks.register("mirrorDebugApkToProject") {
        doLast {
            val source = layout.buildDirectory
                .file("outputs/apk/debug/app-debug.apk")
                .get()
                .asFile
            if (source.isFile) {
                val target = File(mirrorRoot, "outputs/apk/debug/app-debug.apk")
                target.parentFile?.mkdirs()
                source.inputStream().use { input ->
                    target.outputStream().use { output -> input.copyTo(output) }
                }
                logger.lifecycle("PhoneDeck: debug APK mirrored to ${target.absolutePath}")
            }
        }
    }
    tasks.matching { it.name == "assembleDebug" }.configureEach {
        finalizedBy(mirrorDebugApk)
    }
}
