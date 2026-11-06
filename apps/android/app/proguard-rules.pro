# PhoneDeck keeps reflection-free Kotlin Serialization models, so the default
# optimized rules are sufficient. Keep the serializers for the deck model in
# case release minification is enabled later.
-keepclassmembers class com.phonedek.app.data.** {
    *** Companion;
}
-keepclasseswithmembers class com.phonedek.app.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
