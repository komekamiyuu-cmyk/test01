package com.example.tegakimemo.data

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import com.example.tegakimemo.ink.InkRenderer
import com.example.tegakimemo.ink.Page
import com.example.tegakimemo.ink.PageStyle
import com.example.tegakimemo.ink.Stroke
import java.io.File
import java.io.FileOutputStream

/** 一覧に出す小さな画像(1ページ目)を作る。 */
object ThumbnailRenderer {

    private const val WIDTH = 320

    fun render(strokes: List<Stroke>, style: PageStyle): Bitmap {
        val h = (WIDTH * Page.HEIGHT / Page.WIDTH).toInt()
        val bmp = Bitmap.createBitmap(WIDTH, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)
        val s = WIDTH / Page.WIDTH
        canvas.scale(s, s)
        InkRenderer.drawPages(canvas, 1, style, dark = false)
        canvas.clipRect(0f, 0f, Page.WIDTH, Page.HEIGHT)
        for (stroke in strokes) {
            if (stroke.top > Page.HEIGHT) continue      // 1ページ目だけ
            InkRenderer.drawStroke(canvas, stroke)
        }
        return bmp
    }

    /** 書き出し用に1ページを等倍で描く */
    fun renderPage(strokes: List<Stroke>, style: PageStyle, pageIndex: Int, scale: Float = 1.4f): Bitmap {
        val bmp = Bitmap.createBitmap(
            (Page.WIDTH * scale).toInt(),
            (Page.HEIGHT * scale).toInt(),
            Bitmap.Config.ARGB_8888,
        )
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)
        canvas.scale(scale, scale)
        canvas.translate(0f, -Page.top(pageIndex))
        InkRenderer.drawPages(canvas, pageIndex + 1, style, dark = false)
        canvas.clipRect(0f, Page.top(pageIndex), Page.WIDTH, Page.top(pageIndex) + Page.HEIGHT)
        for (stroke in strokes) InkRenderer.drawStroke(canvas, stroke)
        return bmp
    }

    /** 内部ストレージへ保存してパスを返す */
    fun save(dir: File, noteId: String, bitmap: Bitmap): String {
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, "$noteId.png")
        FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 90, out) }
        bitmap.recycle()
        return file.absolutePath
    }
}
