pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "PhoneDeck"
include(":app")

// Host-specific tool chain hints live in the gitignored local.properties.
// On arm64 hosts AGP's x86-64 aapt2 needs an explicit qemu wrapper; on normal
// x86-64 hosts this entry is simply absent.
val localPropertiesFile = file("local.properties")
if (localPropertiesFile.isFile) {
    val localProperties = java.util.Properties()
    localPropertiesFile.inputStream().use { stream -> localProperties.load(stream) }
    localProperties.getProperty("aapt2.override")
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.let { path ->
            val override = file(path)
            if (override.isFile) {
                gradle.beforeProject {
                    it.extensions.extraProperties.set(
                        "android.aapt2FromMavenOverride",
                        override.absolutePath,
                    )
                }
            }
        }
}
