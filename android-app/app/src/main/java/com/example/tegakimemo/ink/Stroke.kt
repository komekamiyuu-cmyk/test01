package com.example.tegakimemo.ink

import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import java.util.UUID

/** 使える道具 */
enum class Tool { PEN, MARKER, ERASER, LASSO }

/** 用紙の種類 */
enum class PageStyle { PLAIN, LINE, GRID, DOT }

/** 用紙のサイズ(ドキュメント座標。A4 の比率 1:1.414) */
object Page {
    const val WIDTH = 1240f
    const val HEIGHT = 1754f
    const val GAP = 28f

    fun top(index: Int): Float = index * (HEIGHT + GAP)
    fun docHeight(pageCount: Int): Float = pageCount * HEIGHT + (pageCount - 1) * GAP
}

/**
 * 一筆分のデータ。points は [x, y, 筆圧] の繰り返しで持つ。
 * ベクタで保持しているので、拡大しても線がぼけない。
 */
@Serializable
data class Stroke(
    val id: String = UUID.randomUUID().toString(),
    val tool: Tool,
    val color: Int,
    val width: Float,
    val points: MutableList<Float> = mutableListOf(),
) {
    /** 当たり判定を速くするための外接矩形(保存対象外。読み込み後に作り直す) */
    @Transient var left = Float.MAX_VALUE
    @Transient var top = Float.MAX_VALUE
    @Transient var right = -Float.MAX_VALUE
    @Transient var bottom = -Float.MAX_VALUE

    val pointCount: Int get() = points.size / 3

    fun x(i: Int) = points[i * 3]
    fun y(i: Int) = points[i * 3 + 1]
    fun pressure(i: Int) = points[i * 3 + 2]

    fun addPoint(x: Float, y: Float, pressure: Float) {
        points.add(x); points.add(y); points.add(pressure)
        val m = width * 0.6f + 1f
        if (x - m < left) left = x - m
        if (x + m > right) right = x + m
        if (y - m < top) top = y - m
        if (y + m > bottom) bottom = y + m
    }

    fun recomputeBounds() {
        left = Float.MAX_VALUE; top = Float.MAX_VALUE
        right = -Float.MAX_VALUE; bottom = -Float.MAX_VALUE
        val m = width * 0.6f + 1f
        var i = 0
        while (i < points.size) {
            val x = points[i]; val y = points[i + 1]
            if (x - m < left) left = x - m
            if (x + m > right) right = x + m
            if (y - m < top) top = y - m
            if (y + m > bottom) bottom = y + m
            i += 3
        }
    }

    fun translate(dx: Float, dy: Float) {
        var i = 0
        while (i < points.size) {
            points[i] += dx
            points[i + 1] += dy
            i += 3
        }
        left += dx; right += dx; top += dy; bottom += dy
    }

    fun copyWithNewId(): Stroke =
        Stroke(UUID.randomUUID().toString(), tool, color, width, points.toMutableList())
            .also { it.recomputeBounds() }

    fun intersects(l: Float, t: Float, r: Float, b: Float): Boolean =
        left <= r && right >= l && top <= b && bottom >= t

    /** 消しゴム用。半径 radius の円が線に触れているか。 */
    fun hits(px: Float, py: Float, radius: Float): Boolean {
        if (!intersects(px - radius, py - radius, px + radius, py + radius)) return false
        val rr = (radius + width * 0.5f) * (radius + width * 0.5f)
        if (pointCount == 1) {
            val dx = x(0) - px; val dy = y(0) - py
            return dx * dx + dy * dy <= rr
        }
        for (i in 0 until pointCount - 1) {
            if (distSqToSegment(px, py, x(i), y(i), x(i + 1), y(i + 1)) <= rr) return true
        }
        return false
    }

    /** なげなわ選択用。点の過半数が多角形の内側なら選択とみなす。 */
    fun mostlyInside(polygon: FloatArray): Boolean {
        var inside = 0
        for (i in 0 until pointCount) {
            if (pointInPolygon(polygon, x(i), y(i))) inside++
        }
        return pointCount > 0 && inside.toFloat() / pointCount >= 0.55f
    }

    companion object {
        fun distSqToSegment(px: Float, py: Float, x0: Float, y0: Float, x1: Float, y1: Float): Float {
            val dx = x1 - x0
            val dy = y1 - y0
            val len = dx * dx + dy * dy
            var t = if (len == 0f) 0f else ((px - x0) * dx + (py - y0) * dy) / len
            t = t.coerceIn(0f, 1f)
            val cx = x0 + t * dx
            val cy = y0 + t * dy
            return (px - cx) * (px - cx) + (py - cy) * (py - cy)
        }

        fun pointInPolygon(poly: FloatArray, x: Float, y: Float): Boolean {
            var inside = false
            var i = 0
            var j = poly.size - 2
            while (i < poly.size) {
                val xi = poly[i]; val yi = poly[i + 1]
                val xj = poly[j]; val yj = poly[j + 1]
                if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
                j = i
                i += 2
            }
            return inside
        }
    }
}

/** 1つのメモの手書き内容 */
@Serializable
data class InkDocument(
    val strokes: MutableList<Stroke> = mutableListOf(),
) {
    fun prepare() = apply { strokes.forEach { it.recomputeBounds() } }
}
