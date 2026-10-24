plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.tamapoke.launcher"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tamapoke.launcher"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the CI-built release APK installs as is.
            // Swap in your own signingConfig before publishing anywhere.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    // The sprites are the same TPK2 files the board reads from its microSD
    // (tools/sdcard/mons). They are copied in at build time rather than
    // duplicated in the repo.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/spriteAssets"))
}

val copySprites by tasks.registering(Copy::class) {
    from(rootProject.file("../tools/sdcard/mons")) {
        // Gradle patterns only know * and ?, so no [0-9]: p*.bin covers pNNN and psNNN
        include("p*.bin")
    }
    into(layout.buildDirectory.dir("generated/spriteAssets/mons"))
}
tasks.named("preBuild") { dependsOn(copySprites) }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
}
