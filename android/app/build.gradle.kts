plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.github.komekamiyuu.cassette"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.komekamiyuu.cassette"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // 画面(HTML/CSS/JS)は music-player/ をそのまま同梱する
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webAssets"))
}

// music-player/ を assets/web/ にコピーする。
// アプリ側にHTMLを複製せず、Web版とAndroid版で同じ画面を使い続けるための仕掛け。
val webAppSource = rootProject.layout.projectDirectory.dir("../music-player")

val copyWebApp by tasks.registering(Copy::class) {
    from(webAppSource) {
        include("index.html", "style.css", "fonts.css", "manifest.json", "js/**", "icons/**")
    }
    into(layout.buildDirectory.dir("generated/webAssets/web"))
}

tasks.named("preBuild") { dependsOn(copyWebApp) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")

    // 再生本体。バックグラウンド再生・ロック画面の操作パネル・音声フォーカスを担う
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-session:1.4.1")
}
