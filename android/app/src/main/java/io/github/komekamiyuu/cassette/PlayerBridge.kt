package io.github.komekamiyuu.cassette

import android.webkit.JavascriptInterface
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import org.json.JSONArray
import org.json.JSONObject

/**
 * 画面(JavaScript)から再生を操作するための窓口。
 *
 * 音を鳴らすのは PlaybackService 側なので、ここは指示を渡すだけ。
 * 逆向き(再生位置や再生中/停止中の通知)は MainActivity のティッカーが担う。
 */
class PlayerBridge(
    private val activity: MainActivity,
    private val controller: () -> Player?,
) {

    /**
     * 再生する曲の並びをまとめて渡し、指定の位置から再生を始める。
     * 曲送り・シャッフルもこの並びの中で完結するので、1曲ごとの往復が要らない。
     */
    @JavascriptInterface
    fun setQueue(tracksJson: String, startIndex: Int) {
        val items = buildItems(tracksJson)
        activity.runOnUiThread {
            val p = controller() ?: return@runOnUiThread
            p.setMediaItems(items, startIndex.coerceIn(0, maxOf(items.size - 1, 0)), 0L)
            p.prepare()
            p.play()
        }
    }

    private fun buildItems(tracksJson: String): List<MediaItem> {
        val arr = JSONArray(tracksJson)
        val items = ArrayList<MediaItem>(arr.length())
        for (i in 0 until arr.length()) {
            val t = arr.optJSONObject(i) ?: continue
            val id = t.optLong("id", -1L)
            if (id < 0) continue
            val albumId = t.optLong("albumId", -1L)

            val metadata = MediaMetadata.Builder()
                .setTitle(t.optString("title"))
                .setArtist(t.optString("artist"))
                .setAlbumTitle(t.optString("album"))
                .apply {
                    // ロック画面に出すジャケット
                    if (albumId > 0) setArtworkUri(MediaLibrary.albumArtUri(albumId))
                }
                .build()

            items.add(
                MediaItem.Builder()
                    .setMediaId(t.optString("key", "media:$id"))
                    .setUri(MediaLibrary.audioUri(id))
                    .setMediaMetadata(metadata)
                    .build(),
            )
        }
        return items
    }

    /** 並びはそのままに、指定の曲へ移る(並べ直しが要らないぶん反応が速い) */
    @JavascriptInterface
    fun seekToIndex(index: Int) = onPlayer {
        if (index in 0 until it.mediaItemCount) {
            it.seekTo(index, 0L)
            it.play()
        }
    }

    @JavascriptInterface
    fun play() = onPlayer { it.play() }

    @JavascriptInterface
    fun pause() = onPlayer { it.pause() }

    @JavascriptInterface
    fun next() = onPlayer { it.seekToNextMediaItem() }

    @JavascriptInterface
    fun previous() = onPlayer {
        // 3秒以上再生していたら曲の頭に戻す(一般的な音楽アプリと同じ挙動)
        if (it.currentPosition > 3000) it.seekTo(0) else it.seekToPreviousMediaItem()
    }

    @JavascriptInterface
    fun seekTo(positionMs: Double) = onPlayer { it.seekTo(positionMs.toLong()) }

    @JavascriptInterface
    fun setShuffle(enabled: Boolean) = onPlayer { it.shuffleModeEnabled = enabled }

    /** 現在の状態を JSON で返す(画面の初期化時に使う) */
    @JavascriptInterface
    fun getState(): String = stateJson(controller())

    private fun onPlayer(action: (Player) -> Unit) {
        activity.runOnUiThread { controller()?.let(action) }
    }

    companion object {
        /** 画面へ渡す再生状態。ティッカーからも使うので共通化してある */
        fun stateJson(p: Player?): String {
            val o = JSONObject()
            if (p == null) {
                o.put("ready", false)
                return o.toString()
            }
            o.put("ready", true)
            o.put("playing", p.isPlaying)
            o.put("index", p.currentMediaItemIndex)
            o.put("positionMs", p.currentPosition.coerceAtLeast(0L))
            val d = p.duration
            o.put("durationMs", if (d > 0) d else 0L)
            o.put("shuffle", p.shuffleModeEnabled)
            return o.toString()
        }
    }
}
