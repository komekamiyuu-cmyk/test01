package com.example.tegakimemo.ink

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.os.SystemClock
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs
import kotlin.math.hypot

/**
 * 手書き入力のためのビュー。
 *
 * - スタイラスの筆圧・履歴点(MotionEvent#getHistorical*)を拾って滑らかな線にする
 * - ペンが触れている間はタッチを無視する(パームリジェクション)
 * - 2本指でスクロール、ピンチでズーム
 * - 描画は「確定済みレイヤー(Bitmap)+ 描き途中の線」の2枚重ね
 */
class InkView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    /* ---------- 外から設定される状態 ---------- */
    var strokes: MutableList<Stroke> = mutableListOf()
        private set
    var pageCount: Int = 1
        private set
    var pageStyle: PageStyle = PageStyle.LINE
        set(value) { field = value; invalidateStatic() }
    var darkPaper: Boolean = false
        set(value) { field = value; invalidateStatic() }

    var tool: Tool = Tool.PEN
    var strokeColor: Int = Color.BLACK
    var penWidth: Float = 3f
    var markerWidth: Float = 22f
    var fingerDrawEnabled: Boolean = false

    var onDocChanged: (() -> Unit)? = null
    var onHistoryChanged: (() -> Unit)? = null
    var onSelectionChanged: ((Boolean) -> Unit)? = null
    var onScaleChanged: ((Float) -> Unit)? = null

    /* ---------- 表示位置 ---------- */
    private var scale = 1f
    private var tx = 0f
    private var ty = 0f
    private var didInitialFit = false

    /* ---------- 描画用 ---------- */
    private var layer: Bitmap? = null
    private var layerCanvas: Canvas? = null
    private var staticDirty = true
    private val lassoPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
        color = 0xFF3D7DFF.toInt()
        pathEffect = android.graphics.DashPathEffect(floatArrayOf(12f, 8f), 0f)
    }
    private val selFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = 0x143D7DFF
    }
    private val eraserPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
        color = 0xFF8A8A9A.toInt()
    }

    /* ---------- 入力状態 ---------- */
    private var current: Stroke? = null
    private var drawingPointerId = -1
    private var panPointerId = -1
    private var lastPanX = 0f
    private var lastPanY = 0f
    private var pinching = false
    private var pinchDist = 0f
    private var pinchCx = 0f
    private var pinchCy = 0f
    private var lastStylusAt = 0L
    private var drawingWithStylus = false
    private var lastX = 0f
    private var lastY = 0f

    private var erasing = false
    private val erased = mutableListOf<Pair<Int, Stroke>>()

    private val lasso = mutableListOf<Float>()
    private var lassoActive = false
    private val selection = linkedSetOf<String>()
    private var dragSel = false
    private var dragDx = 0f
    private var dragDy = 0f
    private var eraserX = Float.NaN
    private var eraserY = Float.NaN

    /* ---------- 履歴 ---------- */
    private sealed interface Op {
        class Add(val ids: List<String>, var items: List<Pair<Int, Stroke>> = emptyList()) : Op
        class Remove(val items: List<Pair<Int, Stroke>>) : Op
        class Move(val ids: List<String>, val dx: Float, val dy: Float) : Op
        class Pages(val delta: Int) : Op
    }

    private val undoStack = ArrayDeque<Op>()
    private val redoStack = ArrayDeque<Op>()

    val canUndo: Boolean get() = undoStack.isNotEmpty()
    val canRedo: Boolean get() = redoStack.isNotEmpty()
    val hasSelection: Boolean get() = selection.isNotEmpty()

    companion object {
        private const val ERASER_RADIUS_DP = 13f
        private const val MIN_STEP_PX = 1.1f
        private const val PALM_GUARD_MS = 1500L
        private const val MAX_HISTORY = 200
    }

    private val eraserRadiusPx = ERASER_RADIUS_DP * resources.displayMetrics.density

    /* ================= 読み込み ================= */

    fun load(doc: InkDocument, pageCount: Int, style: PageStyle) {
        strokes = doc.prepare().strokes
        this.pageCount = pageCount.coerceAtLeast(1)
        pageStyle = style
        undoStack.clear()
        redoStack.clear()
        selection.clear()
        didInitialFit = false
        if (width > 0) fitWidth()
        invalidateStatic()
        onHistoryChanged?.invoke()
        onSelectionChanged?.invoke(false)
    }

    fun snapshot(): InkDocument = InkDocument(strokes.toMutableList())

    /* ================= 表示位置 ================= */

    fun fitWidth() {
        if (width == 0) return
        val margin = 24f * resources.displayMetrics.density
        scale = ((width - margin * 2) / Page.WIDTH).coerceAtLeast(0.15f)
        tx = margin
        ty = 20f
        didInitialFit = true
        onScaleChanged?.invoke(scale)
        invalidateStatic()
    }

    private fun clampView() {
        val docW = Page.WIDTH * scale
        val docH = Page.docHeight(pageCount) * scale
        tx = if (docW < width) (width - docW) / 2f else tx.coerceIn(width - docW - 40f, 40f)
        ty = if (docH < height) minOf(20f, (height - docH) / 2f) else ty.coerceIn(height - docH - 40f, 20f)
    }

    private fun zoomAround(target: Float, cx: Float, cy: Float) {
        val s = target.coerceIn(0.2f, 5f)
        val docX = (cx - tx) / scale
        val docY = (cy - ty) / scale
        scale = s
        tx = cx - docX * s
        ty = cy - docY * s
        clampView()
        onScaleChanged?.invoke(scale)
        invalidateStatic()
    }

    fun currentPageIndex(): Int {
        val midY = (-ty + height / 2f) / scale
        return (midY / (Page.HEIGHT + Page.GAP)).toInt().coerceIn(0, pageCount - 1)
    }

    fun scrollToPage(index: Int) {
        ty = -Page.top(index) * scale + 20f
        clampView()
        invalidateStatic()
    }

    private fun toDocX(sx: Float) = (sx - tx) / scale
    private fun toDocY(sy: Float) = (sy - ty) / scale

    /* ================= 描画 ================= */

    private fun invalidateStatic() {
        staticDirty = true
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w <= 0 || h <= 0) return
        layer?.recycle()
        layer = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        layerCanvas = Canvas(layer!!)
        if (!didInitialFit) fitWidth() else clampView()
        invalidateStatic()
    }

    private fun renderStatic() {
        val c = layerCanvas ?: return
        c.drawColor(if (darkPaper) 0xFF101116.toInt() else 0xFFEBEBEF.toInt(), android.graphics.PorterDuff.Mode.SRC)
        val save = c.save()
        c.translate(tx, ty)
        c.scale(scale, scale)
        InkRenderer.drawPages(c, pageCount, pageStyle, darkPaper)

        val l = toDocX(0f); val t = toDocY(0f)
        val r = toDocX(width.toFloat()); val b = toDocY(height.toFloat())
        val clipSave = c.save()
        InkRenderer.clipToPages(c, pageCount)
        for (s in strokes) {
            if (!s.intersects(l, t, r, b)) continue      // 画面外は描かない
            InkRenderer.drawStroke(c, s)
        }
        c.restoreToCount(clipSave)

        if (selection.isNotEmpty()) drawSelectionBox(c)
        c.restoreToCount(save)
        staticDirty = false
    }

    private fun selectionBounds(): FloatArray? {
        var l = Float.MAX_VALUE; var t = Float.MAX_VALUE
        var r = -Float.MAX_VALUE; var b = -Float.MAX_VALUE
        for (s in strokes) {
            if (s.id !in selection) continue
            l = minOf(l, s.left); t = minOf(t, s.top)
            r = maxOf(r, s.right); b = maxOf(b, s.bottom)
        }
        return if (l == Float.MAX_VALUE) null else floatArrayOf(l, t, r, b)
    }

    private fun drawSelectionBox(c: Canvas) {
        val bb = selectionBounds() ?: return
        c.drawRect(bb[0] - 6f, bb[1] - 6f, bb[2] + 6f, bb[3] + 6f, selFillPaint)
        val p = Paint(lassoPaint).apply { strokeWidth = 1.5f / scale }
        c.drawRect(bb[0] - 6f, bb[1] - 6f, bb[2] + 6f, bb[3] + 6f, p)
    }

    override fun onDraw(canvas: Canvas) {
        if (staticDirty) renderStatic()
        layer?.let { canvas.drawBitmap(it, 0f, 0f, null) }

        val save = canvas.save()
        canvas.translate(tx, ty)
        canvas.scale(scale, scale)

        current?.let {
            val clipSave = canvas.save()
            InkRenderer.clipToPages(canvas, pageCount)
            InkRenderer.drawStroke(canvas, it)
            canvas.restoreToCount(clipSave)
        }

        if (lassoActive && lasso.size >= 4) {
            val p = Path()
            p.moveTo(lasso[0], lasso[1])
            var i = 2
            while (i < lasso.size) { p.lineTo(lasso[i], lasso[i + 1]); i += 2 }
            p.close()
            canvas.drawPath(p, selFillPaint)
            canvas.drawPath(p, Paint(lassoPaint).apply { strokeWidth = 1.5f / scale })
        }

        if (!eraserX.isNaN()) {
            canvas.drawCircle(eraserX, eraserY, eraserRadiusPx / scale,
                Paint(eraserPaint).apply { strokeWidth = 1f / scale })
        }
        canvas.restoreToCount(save)
    }

    /* ================= 入力 ================= */

    private fun toolTypeOf(event: MotionEvent, index: Int): Int = event.getToolType(index)

    private fun touchDrawAllowed(): Boolean =
        fingerDrawEnabled && SystemClock.uptimeMillis() - lastStylusAt > PALM_GUARD_MS

    /** スタイラス以外は筆圧を一定にする(指やマウスは 1.0 が来て太くなりすぎるため) */
    private fun pressureOf(event: MotionEvent, index: Int, historical: Int = -1): Float {
        if (toolTypeOf(event, index) != MotionEvent.TOOL_TYPE_STYLUS) return 0.5f
        val p = if (historical >= 0) event.getHistoricalPressure(index, historical) else event.getPressure(index)
        return if (p > 0f && p <= 1f) p else 0.5f
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        val action = event.actionMasked
        val index = event.actionIndex
        val toolType = toolTypeOf(event, index)
        val isStylus = toolType == MotionEvent.TOOL_TYPE_STYLUS || toolType == MotionEvent.TOOL_TYPE_ERASER

        when (action) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                if (isStylus) lastStylusAt = SystemClock.uptimeMillis()
                if (!isStylus && toolType == MotionEvent.TOOL_TYPE_FINGER && !touchDrawAllowed()) {
                    beginPan(event, index)
                } else {
                    beginInput(event, index, toolType)
                }
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                when {
                    // 手のひらが先に触れていても、ペンが降りてきたらそちらを優先する
                    isStylus -> {
                        lastStylusAt = SystemClock.uptimeMillis()
                        panPointerId = -1
                        pinching = false
                        beginInput(event, index, toolType)
                    }
                    // ペンで描いている最中のタッチは手のひらとみなして無視する
                    drawingWithStylus -> Unit

                    event.pointerCount >= 2 -> {
                        // 2本目の指 → ピンチ操作に切り替え(描きかけは取り消す)
                        cancelCurrentStroke()
                        beginPinch(event)
                    }
                }
            }

            MotionEvent.ACTION_MOVE -> {
                when {
                    pinching -> updatePinch(event)
                    panPointerId >= 0 -> {
                        val i = event.findPointerIndex(panPointerId)
                        if (i >= 0) {
                            tx += event.getX(i) - lastPanX
                            ty += event.getY(i) - lastPanY
                            lastPanX = event.getX(i)
                            lastPanY = event.getY(i)
                            clampView()
                            invalidateStatic()
                        }
                    }
                    else -> handleMove(event)
                }
            }

            MotionEvent.ACTION_POINTER_UP -> {
                // 指が残っていてもペンが離れたら、その一筆は確定させる
                if (event.getPointerId(index) == drawingPointerId) finishInput(cancelled = false)
                if (pinching && event.pointerCount <= 2) pinching = false
            }

            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                finishInput(cancelled = action == MotionEvent.ACTION_CANCEL)
                pinching = false
                panPointerId = -1
            }
        }
        return true
    }

    private fun beginPan(event: MotionEvent, index: Int) {
        panPointerId = event.getPointerId(index)
        lastPanX = event.getX(index)
        lastPanY = event.getY(index)
    }

    private fun beginPinch(event: MotionEvent) {
        if (event.pointerCount < 2) return
        panPointerId = -1
        pinching = true
        pinchDist = hypot(event.getX(0) - event.getX(1), event.getY(0) - event.getY(1))
        pinchCx = (event.getX(0) + event.getX(1)) / 2f
        pinchCy = (event.getY(0) + event.getY(1)) / 2f
    }

    private fun updatePinch(event: MotionEvent) {
        if (event.pointerCount < 2) return
        val dist = hypot(event.getX(0) - event.getX(1), event.getY(0) - event.getY(1))
        val cx = (event.getX(0) + event.getX(1)) / 2f
        val cy = (event.getY(0) + event.getY(1)) / 2f
        tx += cx - pinchCx
        ty += cy - pinchCy
        pinchCx = cx
        pinchCy = cy
        if (pinchDist > 8f) {
            zoomAround(scale * (dist / pinchDist), cx, cy)
            pinchDist = dist
        } else {
            clampView()
            invalidateStatic()
        }
    }

    private fun beginInput(event: MotionEvent, index: Int, toolType: Int) {
        val x = event.getX(index)
        val y = event.getY(index)
        val docX = toDocX(x)
        val docY = toDocY(y)
        drawingPointerId = event.getPointerId(index)
        drawingWithStylus = toolType == MotionEvent.TOOL_TYPE_STYLUS || toolType == MotionEvent.TOOL_TYPE_ERASER
        lastX = x
        lastY = y

        // ペンのお尻(消しゴム側)や消しゴムボタンは自動で消しゴムに切り替える
        val effective = when {
            toolType == MotionEvent.TOOL_TYPE_ERASER -> Tool.ERASER
            event.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY != 0 -> Tool.ERASER
            else -> tool
        }

        when (effective) {
            Tool.ERASER -> {
                erasing = true
                erased.clear()
                eraserX = docX; eraserY = docY
                eraseAt(docX, docY)
                invalidate()
            }
            Tool.LASSO -> {
                val bb = selectionBounds()
                if (selection.isNotEmpty() && bb != null &&
                    docX >= bb[0] - 10 && docX <= bb[2] + 10 && docY >= bb[1] - 10 && docY <= bb[3] + 10
                ) {
                    dragSel = true
                    dragDx = 0f; dragDy = 0f
                } else {
                    clearSelection()
                    lasso.clear()
                    lasso.add(docX); lasso.add(docY)
                    lassoActive = true
                }
                invalidate()
            }
            else -> {
                clearSelection()
                val w = if (effective == Tool.MARKER) markerWidth else penWidth
                val s = Stroke(tool = effective, color = strokeColor, width = w)
                s.addPoint(docX, docY, pressureOf(event, index))
                current = s
                invalidate()
            }
        }
    }

    private fun handleMove(event: MotionEvent) {
        val index = event.findPointerIndex(drawingPointerId)
        if (index < 0) return

        // 履歴点も拾うと、速く動かしたときの線がカクつかない
        for (h in 0 until event.historySize) {
            consumePoint(
                event.getHistoricalX(index, h),
                event.getHistoricalY(index, h),
                pressureOf(event, index, h),
                event,
            )
        }
        consumePoint(event.getX(index), event.getY(index), pressureOf(event, index), event)
        invalidate()
    }

    private fun consumePoint(x: Float, y: Float, pressure: Float, event: MotionEvent) {
        when {
            erasing -> {
                eraserX = toDocX(x); eraserY = toDocY(y)
                eraseAt(eraserX, eraserY)
            }
            dragSel -> {
                val dx = (x - lastX) / scale
                val dy = (y - lastY) / scale
                lastX = x; lastY = y
                dragDx += dx; dragDy += dy
                for (s in strokes) if (s.id in selection) s.translate(dx, dy)
                invalidateStatic()
            }
            lassoActive -> {
                val docX = toDocX(x); val docY = toDocY(y)
                val n = lasso.size
                if (n < 2 || hypot(docX - lasso[n - 2], docY - lasso[n - 1]) > 3f / scale) {
                    lasso.add(docX); lasso.add(docY)
                }
            }
            else -> {
                val s = current ?: return
                if (abs(x - lastX) < MIN_STEP_PX && abs(y - lastY) < MIN_STEP_PX) return
                lastX = x; lastY = y
                var docX = toDocX(x)
                var docY = toDocY(y)
                var p = pressure
                if (s.pointCount > 0) {
                    // 軽い平滑化で手ブレを抑える
                    val i = s.pointCount - 1
                    docX = s.x(i) * 0.35f + docX * 0.65f
                    docY = s.y(i) * 0.35f + docY * 0.65f
                    p = s.pressure(i) * 0.5f + p * 0.5f
                }
                s.addPoint(docX, docY, p)
            }
        }
    }

    private fun finishInput(cancelled: Boolean) {
        eraserX = Float.NaN
        eraserY = Float.NaN

        current?.let { s ->
            current = null
            if (!cancelled && s.pointCount >= 1) {
                strokes.add(s)
                pushOp(Op.Add(listOf(s.id)))
            }
            invalidateStatic()
        }

        if (erasing) {
            erasing = false
            if (erased.isNotEmpty()) pushOp(Op.Remove(erased.toList()))
            erased.clear()
            invalidateStatic()
        }

        if (lassoActive) {
            lassoActive = false
            if (lasso.size >= 8) selectByPolygon(lasso.toFloatArray())
            lasso.clear()
            invalidateStatic()
            onSelectionChanged?.invoke(selection.isNotEmpty())
        }

        if (dragSel) {
            dragSel = false
            if (abs(dragDx) > 0.5f || abs(dragDy) > 0.5f) {
                pushOp(Op.Move(selection.toList(), dragDx, dragDy))
            }
            invalidateStatic()
        }
        drawingPointerId = -1
        drawingWithStylus = false
    }

    private fun cancelCurrentStroke() {
        current = null
        drawingWithStylus = false
        lassoActive = false
        lasso.clear()
        invalidateStatic()
    }

    /* ================= 消しゴム・選択 ================= */

    private fun eraseAt(docX: Float, docY: Float) {
        val r = eraserRadiusPx / scale
        for (i in strokes.indices.reversed()) {
            val s = strokes[i]
            if (s.hits(docX, docY, r)) {
                strokes.removeAt(i)
                erased.add(i to s)
                invalidateStatic()
            }
        }
    }

    private fun selectByPolygon(poly: FloatArray) {
        selection.clear()
        var l = Float.MAX_VALUE; var t = Float.MAX_VALUE
        var r = -Float.MAX_VALUE; var b = -Float.MAX_VALUE
        var i = 0
        while (i < poly.size) {
            l = minOf(l, poly[i]); r = maxOf(r, poly[i])
            t = minOf(t, poly[i + 1]); b = maxOf(b, poly[i + 1])
            i += 2
        }
        for (s in strokes) {
            if (!s.intersects(l, t, r, b)) continue
            if (s.mostlyInside(poly)) selection.add(s.id)
        }
    }

    fun clearSelection() {
        if (selection.isEmpty()) return
        selection.clear()
        invalidateStatic()
        onSelectionChanged?.invoke(false)
    }

    fun deleteSelection() {
        val items = mutableListOf<Pair<Int, Stroke>>()
        for (i in strokes.indices.reversed()) {
            if (strokes[i].id in selection) {
                items.add(i to strokes[i])
                strokes.removeAt(i)
            }
        }
        if (items.isEmpty()) return
        selection.clear()
        onSelectionChanged?.invoke(false)
        pushOp(Op.Remove(items))
        invalidateStatic()
    }

    fun duplicateSelection() {
        val copies = strokes.filter { it.id in selection }.map { it.copyWithNewId().also { c -> c.translate(24f, 24f) } }
        if (copies.isEmpty()) return
        strokes.addAll(copies)
        selection.clear()
        copies.forEach { selection.add(it.id) }
        pushOp(Op.Add(copies.map { it.id }))
        invalidateStatic()
        onSelectionChanged?.invoke(true)
    }

    /* ================= ページ ================= */

    fun addPage() {
        pageCount++
        pushOp(Op.Pages(1))
        scrollToPage(pageCount - 1)
    }

    fun clearAll() {
        if (strokes.isEmpty()) return
        val items = strokes.indices.reversed().map { it to strokes[it] }
        strokes.clear()
        pushOp(Op.Remove(items))
        invalidateStatic()
    }

    /* ================= 履歴 ================= */

    private fun pushOp(op: Op) {
        undoStack.addLast(op)
        if (undoStack.size > MAX_HISTORY) undoStack.removeFirst()
        redoStack.clear()
        onHistoryChanged?.invoke()
        onDocChanged?.invoke()
    }

    fun undo() {
        val op = undoStack.removeLastOrNull() ?: return
        applyInverse(op)
        redoStack.addLast(op)
        afterHistory()
    }

    fun redo() {
        val op = redoStack.removeLastOrNull() ?: return
        applyForward(op)
        undoStack.addLast(op)
        afterHistory()
    }

    private fun afterHistory() {
        clearSelection()
        invalidateStatic()
        onHistoryChanged?.invoke()
        onDocChanged?.invoke()
    }

    private fun applyInverse(op: Op) {
        when (op) {
            is Op.Add -> {
                val ids = op.ids.toSet()
                val items = mutableListOf<Pair<Int, Stroke>>()
                for (i in strokes.indices.reversed()) {
                    if (strokes[i].id in ids) {
                        items.add(i to strokes[i])
                        strokes.removeAt(i)
                    }
                }
                op.items = items
            }
            is Op.Remove -> op.items.reversed().forEach { (i, s) -> strokes.add(i.coerceAtMost(strokes.size), s) }
            is Op.Move -> {
                val ids = op.ids.toSet()
                strokes.filter { it.id in ids }.forEach { it.translate(-op.dx, -op.dy) }
            }
            is Op.Pages -> pageCount = (pageCount - op.delta).coerceAtLeast(1)
        }
    }

    private fun applyForward(op: Op) {
        when (op) {
            is Op.Add -> op.items.reversed().forEach { (i, s) -> strokes.add(i.coerceAtMost(strokes.size), s) }
            is Op.Remove -> {
                val ids = op.items.map { it.second.id }.toSet()
                for (i in strokes.indices.reversed()) if (strokes[i].id in ids) strokes.removeAt(i)
            }
            is Op.Move -> {
                val ids = op.ids.toSet()
                strokes.filter { it.id in ids }.forEach { it.translate(op.dx, op.dy) }
            }
            is Op.Pages -> pageCount += op.delta
        }
    }
}
