package com.example.tegakimemo.ink

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path

/**
 * ストロークと用紙を Canvas に描く。
 * Canvas 側にドキュメント座標への変換(scale / translate)が掛かっている前提。
 */
object InkRenderer {

    const val MARKER_ALPHA = 87            // 0..255。約34%

    // サムネイル生成はバックグラウンドスレッドで走るため、Paint はスレッドごとに持つ
    private val strokePaintLocal = ThreadLocal.withInitial {
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
    }
    private val fillPaintLocal = ThreadLocal.withInitial {
        Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    }
    private val pathLocal = ThreadLocal.withInitial { Path() }

    private val strokePaint: Paint get() = strokePaintLocal.get()!!
    private val fillPaint: Paint get() = fillPaintLocal.get()!!
    private val path: Path get() = pathLocal.get()!!

    /** 筆圧から実際の線幅を出す。筆圧非対応の入力では 0.5 が来るので等倍になる。 */
    fun widthFor(stroke: Stroke, pressure: Float): Float =
        if (stroke.tool == Tool.MARKER) stroke.width
        else (stroke.width * (0.5f + pressure)).coerceAtLeast(0.35f)

    fun drawStroke(canvas: Canvas, stroke: Stroke) {
        val n = stroke.pointCount
        if (n == 0) return

        if (stroke.tool == Tool.MARKER) {
            // マーカーは半透明。重なりで濃くならないよう、1本のパスにまとめて一度だけ描く。
            strokePaint.color = stroke.color
            strokePaint.alpha = MARKER_ALPHA
            strokePaint.strokeWidth = stroke.width
            path.reset()
            path.moveTo(stroke.x(0), stroke.y(0))
            if (n == 1) {
                path.lineTo(stroke.x(0) + 0.01f, stroke.y(0))
            } else {
                for (i in 1 until n - 1) {
                    path.quadTo(
                        stroke.x(i), stroke.y(i),
                        (stroke.x(i) + stroke.x(i + 1)) / 2f,
                        (stroke.y(i) + stroke.y(i + 1)) / 2f,
                    )
                }
                path.lineTo(stroke.x(n - 1), stroke.y(n - 1))
            }
            canvas.drawPath(path, strokePaint)
            return
        }

        if (n == 1) {
            fillPaint.color = stroke.color
            canvas.drawCircle(stroke.x(0), stroke.y(0), widthFor(stroke, stroke.pressure(0)) / 2f, fillPaint)
            return
        }

        // ペンは筆圧で太さが変わるので、区間ごとに線幅を変えて描く
        strokePaint.color = stroke.color
        strokePaint.alpha = Color.alpha(stroke.color)
        var px = stroke.x(0)
        var py = stroke.y(0)
        for (i in 1 until n) {
            val last = i == n - 1
            val mx = if (last) stroke.x(i) else (stroke.x(i) + stroke.x(i + 1)) / 2f
            val my = if (last) stroke.y(i) else (stroke.y(i) + stroke.y(i + 1)) / 2f
            strokePaint.strokeWidth = widthFor(stroke, (stroke.pressure(i) + stroke.pressure(i - 1)) / 2f)
            path.reset()
            path.moveTo(px, py)
            path.quadTo(stroke.x(i), stroke.y(i), mx, my)
            canvas.drawPath(path, strokePaint)
            px = mx
            py = my
        }
    }

    /** 用紙(ページ)の背景。dark のときは黒っぽい紙にする。 */
    fun drawPages(canvas: Canvas, pageCount: Int, style: PageStyle, dark: Boolean) {
        val paper = if (dark) 0xFF22232A.toInt() else Color.WHITE
        val rule = if (dark) 0xFF34394A.toInt() else 0xFFDBE4F2.toInt()
        val pageNo = if (dark) 0xFF5C6070.toInt() else 0xFFB9BCC8.toInt()

        for (i in 0 until pageCount) {
            val top = Page.top(i)
            fillPaint.color = paper
            fillPaint.setShadowLayer(14f, 0f, 3f, 0x38000000)
            canvas.drawRect(0f, top, Page.WIDTH, top + Page.HEIGHT, fillPaint)
            fillPaint.clearShadowLayer()

            val save = canvas.save()
            canvas.clipRect(0f, top, Page.WIDTH, top + Page.HEIGHT)
            strokePaint.color = rule
            strokePaint.alpha = 255
            strokePaint.strokeWidth = 1f
            fillPaint.color = rule

            when (style) {
                PageStyle.LINE -> {
                    var y = top + 96f
                    while (y < top + Page.HEIGHT - 40f) {
                        canvas.drawLine(56f, y, Page.WIDTH - 56f, y, strokePaint)
                        y += 48f
                    }
                }
                PageStyle.GRID -> {
                    var y = top + 40f
                    while (y < top + Page.HEIGHT) {
                        canvas.drawLine(0f, y, Page.WIDTH, y, strokePaint); y += 40f
                    }
                    var x = 40f
                    while (x < Page.WIDTH) {
                        canvas.drawLine(x, top, x, top + Page.HEIGHT, strokePaint); x += 40f
                    }
                }
                PageStyle.DOT -> {
                    var y = top + 40f
                    while (y < top + Page.HEIGHT) {
                        var x = 40f
                        while (x < Page.WIDTH) {
                            canvas.drawCircle(x, y, 1.6f, fillPaint); x += 40f
                        }
                        y += 40f
                    }
                }
                PageStyle.PLAIN -> Unit
            }
            canvas.restoreToCount(save)

            fillPaint.color = pageNo
            fillPaint.textSize = 20f
            fillPaint.textAlign = Paint.Align.CENTER
            canvas.drawText((i + 1).toString(), Page.WIDTH / 2f, top + Page.HEIGHT - 22f, fillPaint)
            fillPaint.textAlign = Paint.Align.LEFT
        }
    }

    /** 用紙からはみ出した線を隠すためのクリップ */
    fun clipToPages(canvas: Canvas, pageCount: Int) {
        val clip = Path()
        for (i in 0 until pageCount) {
            clip.addRect(0f, Page.top(i), Page.WIDTH, Page.top(i) + Page.HEIGHT, Path.Direction.CW)
        }
        canvas.clipPath(clip)
    }
}
