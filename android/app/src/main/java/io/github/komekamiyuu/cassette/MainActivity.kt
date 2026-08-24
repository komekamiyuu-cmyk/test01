package io.github.komekamiyuu.cassette

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.FileInputStream
import java.io.InputStream

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    private val audioPermission: String
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else {
            @Suppress("DEPRECATION")
            Manifest.permission.READ_EXTERNAL_STORAGE
        }

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            // 許可の結果に関わらず画面側へ通知する(拒否時は案内を出すため)
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.__onLibraryReady && window.__onLibraryReady($granted)",
                    null,
                )
            }
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true            // お気に入り・プレイリストの保存に必要
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_NO_CACHE
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = serve(request)
        }

        webView.addJavascriptInterface(Bridge(), "AndroidLibrary")
        webView.loadUrl("https://${MediaLibrary.HOST}/web/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // 再生中画面が開いていれば閉じる。そうでなければアプリを終了する
                webView.evaluateJavascript(
                    "window.__androidBack ? window.__androidBack() : false",
                ) { result ->
                    if (result != "true") finish()
                }
            }
        })
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    // ---------- WebView からのリクエストを端末内で解決する ----------

    private fun serve(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (url.host != MediaLibrary.HOST) return null
        val path = url.path ?: return null

        return when {
            path.startsWith("/web/") -> serveAsset(path.removePrefix("/"))
            path.startsWith("/media/") -> serveAudio(path.removePrefix("/media/"), request)
            path.startsWith("/art/") -> serveAlbumArt(path.removePrefix("/art/"))
            else -> null
        }
    }

    /** APK に同梱した画面(HTML/CSS/JS)を返す */
    private fun serveAsset(assetPath: String): WebResourceResponse? = try {
        WebResourceResponse(mimeOf(assetPath), "UTF-8", assets.open(assetPath))
    } catch (e: Exception) {
        null
    }

    /**
     * 曲の実体を返す。シーク(再生位置の変更)のために Range リクエストへ対応している。
     * 対応しないと、ブラウザによっては途中への移動ができなくなる。
     */
    private fun serveAudio(idText: String, request: WebResourceRequest): WebResourceResponse? {
        val id = idText.toLongOrNull() ?: return null
        return try {
            val uri = MediaLibrary.audioUri(id)
            val mime = contentResolver.getType(uri) ?: "audio/mpeg"
            val pfd = contentResolver.openFileDescriptor(uri, "r") ?: return null
            val total = pfd.statSize

            val range = request.requestHeaders["Range"] ?: request.requestHeaders["range"]
            val match = range?.let { Regex("bytes=(\\d*)-(\\d*)").find(it) }

            if (match == null || total <= 0) {
                val stream = FileInputStream(pfd.fileDescriptor)
                WebResourceResponse(
                    mime, null, 200, "OK",
                    mapOf("Accept-Ranges" to "bytes", "Content-Length" to total.toString()),
                    stream,
                )
            } else {
                val start = match.groupValues[1].toLongOrNull() ?: 0L
                val end = match.groupValues[2].toLongOrNull()?.coerceAtMost(total - 1) ?: (total - 1)
                if (start > end) {
                    pfd.close()
                    return WebResourceResponse(
                        mime, null, 416, "Range Not Satisfiable",
                        mapOf("Content-Range" to "bytes */$total"), null,
                    )
                }
                val stream = FileInputStream(pfd.fileDescriptor)
                stream.channel.position(start)
                val length = end - start + 1
                WebResourceResponse(
                    mime, null, 206, "Partial Content",
                    mapOf(
                        "Accept-Ranges" to "bytes",
                        "Content-Range" to "bytes $start-$end/$total",
                        "Content-Length" to length.toString(),
                    ),
                    bounded(stream, length),
                )
            }
        } catch (e: Exception) {
            null
        }
    }

    /** アルバムのジャケット画像を返す */
    private fun serveAlbumArt(albumIdText: String): WebResourceResponse? {
        val albumId = albumIdText.toLongOrNull() ?: return null
        return try {
            val stream = contentResolver.openInputStream(MediaLibrary.albumArtUri(albumId))
                ?: return null
            WebResourceResponse("image/jpeg", null, stream)
        } catch (e: Exception) {
            // ジャケットが無いアルバムは珍しくないので、静かに諦めて代替表示に任せる
            null
        }
    }

    /** 指定バイト数までで打ち切るストリーム(Content-Length と実際の長さを一致させる) */
    private fun bounded(source: InputStream, limit: Long): InputStream = object : InputStream() {
        private var remaining = limit

        override fun read(): Int {
            if (remaining <= 0) return -1
            val b = source.read()
            if (b >= 0) remaining--
            return b
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (remaining <= 0) return -1
            val toRead = minOf(len.toLong(), remaining).toInt()
            val n = source.read(b, off, toRead)
            if (n > 0) remaining -= n
            return n
        }

        override fun available(): Int = minOf(source.available().toLong(), remaining).toInt()

        override fun close() = source.close()
    }

    private fun mimeOf(path: String): String = when {
        path.endsWith(".html") -> "text/html"
        path.endsWith(".css") -> "text/css"
        path.endsWith(".js") -> "text/javascript"
        path.endsWith(".json") -> "application/json"
        path.endsWith(".png") -> "image/png"
        path.endsWith(".svg") -> "image/svg+xml"
        path.endsWith(".woff2") -> "font/woff2"
        else -> "application/octet-stream"
    }

    // ---------- 画面(JavaScript)から呼ばれる窓口 ----------

    inner class Bridge {

        @JavascriptInterface
        fun hasPermission(): Boolean =
            ContextCompat.checkSelfPermission(this@MainActivity, audioPermission) ==
                PackageManager.PERMISSION_GRANTED

        @JavascriptInterface
        fun requestPermission() {
            runOnUiThread { permissionLauncher.launch(audioPermission) }
        }

        /** 端末内の曲一覧を JSON で返す */
        @JavascriptInterface
        fun listTracks(): String =
            if (hasPermission()) MediaLibrary.listTracksJson(this@MainActivity) else "[]"
    }
}
