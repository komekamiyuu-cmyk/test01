package io.github.komekamiyuu.cassette

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject

/**
 * 端末に入っている音楽を MediaStore から読み出す。
 *
 * Web版はユーザーにフォルダを選ばせていたが、Android版では OS が持っている
 * 音楽インデックスをそのまま使うので、起動するたびに選び直す必要がない。
 */
object MediaLibrary {

    /** WebView から参照する仮想ホスト。実際の通信は発生しない(全て端末内で解決する) */
    const val HOST = "appassets.androidplatform.net"

    private val projection: Array<String>
        get() {
            val base = mutableListOf(
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.ALBUM_ID,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.TRACK,
                MediaStore.Audio.Media.MIME_TYPE,
            )
            // ジャンル列は Android 11 以降でしか引けない
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                base.add(MediaStore.Audio.Media.GENRE)
            }
            return base.toTypedArray()
        }

    // 一覧は起動のたびに引き直さず、プロセス内で使い回す(2回目以降の表示を速くする)
    @Volatile
    private var cached: String? = null

    /**
     * 曲の一覧を JSON 文字列で返す。
     * 画面側はこれをそのまま描画に使う(Web版のトラック構造に合わせてある)。
     */
    fun listTracksJson(context: Context, forceRefresh: Boolean = false): String {
        cached?.let { if (!forceRefresh) return it }
        val json = query(context)
        cached = json
        return json
    }

    private fun query(context: Context): String {
        val out = JSONArray()
        val collection: Uri =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
            } else {
                @Suppress("DEPRECATION")
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
            }

        // 着信音・通知音・アラーム音を除き、音楽として登録されているものだけを対象にする
        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0"
        val order = "${MediaStore.Audio.Media.ALBUM} COLLATE NOCASE ASC, " +
            "${MediaStore.Audio.Media.TRACK} ASC, " +
            "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"

        context.contentResolver.query(collection, projection, selection, null, order)?.use { c ->
            val idCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val titleCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val artistCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val albumCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val albumIdCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
            val durationCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            val genreCol =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    c.getColumnIndex(MediaStore.Audio.Media.GENRE)
                } else {
                    -1
                }

            while (c.moveToNext()) {
                val id = c.getLong(idCol)
                val albumId = c.getLong(albumIdCol)
                val unknownArtist = "不明なアーティスト"
                val unknownAlbum = "不明なアルバム"

                val o = JSONObject()
                o.put("key", "media:$id")
                o.put("id", id)        // 再生はこのIDから content:// を組み立てて行う
                o.put("albumId", albumId)
                o.put("title", c.getString(titleCol) ?: "無題")
                o.put("artist", normalize(c.getString(artistCol), unknownArtist))
                o.put("album", normalize(c.getString(albumCol), unknownAlbum))
                o.put("genre", if (genreCol >= 0) normalize(c.getString(genreCol), "不明") else "不明")
                o.put("duration", c.getLong(durationCol) / 1000.0)
                o.put("url", "https://$HOST/media/$id")
                o.put("artUrl", if (albumId > 0) "https://$HOST/art/$albumId" else JSONObject.NULL)
                out.put(o)
            }
        }
        return out.toString()
    }

    /** MediaStore は不明な値を "<unknown>" で返してくることがある */
    private fun normalize(value: String?, fallback: String): String {
        val v = value?.trim()
        return if (v.isNullOrEmpty() || v == "<unknown>") fallback else v
    }

    fun audioUri(id: Long): Uri =
        ContentUris.withAppendedId(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
            } else {
                @Suppress("DEPRECATION")
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
            },
            id,
        )

    fun albumArtUri(albumId: Long): Uri =
        ContentUris.withAppendedId(
            Uri.parse("content://media/external/audio/albumart"),
            albumId,
        )
}
