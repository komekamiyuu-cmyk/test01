package com.example.tegakimemo.ui.editor

import android.graphics.Bitmap
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.example.tegakimemo.data.ThumbnailRenderer
import com.example.tegakimemo.ink.InkView
import com.example.tegakimemo.ink.PageStyle
import com.example.tegakimemo.ink.Tool
import kotlinx.coroutines.launch

private val PALETTE = listOf(
    Color(0xFF1C1C22), Color(0xFF3D7DFF), Color(0xFFE3524B),
    Color(0xFF22A06B), Color(0xFFF2A516), Color(0xFF8A4FD8), Color(0xFFFFFFFF),
)
private val PEN_WIDTHS = listOf(1.6f, 3f, 5f, 9f)
private val MARKER_WIDTHS = listOf(14f, 22f, 34f)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(vm: EditorViewModel, onBack: () -> Unit) {
    var inkView by remember { mutableStateOf<InkView?>(null) }
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var pendingPng by remember { mutableStateOf<Bitmap?>(null) }

    fun snapshot(): EditorSnapshot {
        val v = inkView
        return EditorSnapshot(
            doc = v?.snapshot() ?: com.example.tegakimemo.ink.InkDocument(),
            pageCount = v?.pageCount ?: 1,
            pageStyle = vm.pageStyle,
        )
    }

    fun leave() = vm.saveNow(snapshot()) { onBack() }

    BackHandler { leave() }

    val pngLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("image/png")
    ) { uri ->
        val bmp = pendingPng
        pendingPng = null
        if (uri == null || bmp == null) return@rememberLauncherForActivityResult
        context.contentResolver.openOutputStream(uri)?.use { bmp.compress(Bitmap.CompressFormat.PNG, 95, it) }
        bmp.recycle()
        scope.launch { snackbar.showSnackbar("画像を保存しました") }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            EditorTopBar(
                vm = vm,
                onBack = { leave() },
                onUndo = { inkView?.undo() },
                onRedo = { inkView?.redo() },
                onAddPage = { inkView?.addPage(); vm.markDirty(::snapshot) },
                onPageStyle = { style ->
                    vm.pageStyle = style
                    inkView?.pageStyle = style
                    vm.markDirty(::snapshot)
                },
                onExportPng = {
                    val v = inkView ?: return@EditorTopBar
                    pendingPng = ThumbnailRenderer.renderPage(v.strokes, vm.pageStyle, v.currentPageIndex())
                    pngLauncher.launch("${vm.title.ifBlank { "memo" }}-p${v.currentPageIndex() + 1}.png")
                },
                onClearAll = { inkView?.clearAll() },
            )
        },
    ) { padding ->
        Row(Modifier.padding(padding).fillMaxSize()) {
            ToolPalette(vm, onFit = { inkView?.fitWidth() })

            Box(Modifier.weight(1f).fillMaxHeight()) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        InkView(ctx).also { view ->
                            inkView = view
                            view.onDocChanged = { vm.markDirty(::snapshot) }
                            view.onHistoryChanged = {
                                vm.canUndo = view.canUndo
                                vm.canRedo = view.canRedo
                            }
                            view.onSelectionChanged = { vm.hasSelection = it }
                            view.onScaleChanged = { vm.zoomPercent = (it * 100).toInt() }
                        }
                    },
                    update = { view ->
                        view.tool = vm.tool
                        view.strokeColor = vm.color.toArgb()
                        view.penWidth = vm.penWidth
                        view.markerWidth = vm.markerWidth
                        view.fingerDrawEnabled = vm.fingerDraw
                        view.darkPaper = dark
                    },
                )

                // 読み込みが終わったら、その内容をビューへ渡す
                LaunchedEffect(vm.loadedDoc, inkView) {
                    val doc = vm.loadedDoc ?: return@LaunchedEffect
                    val view = inkView ?: return@LaunchedEffect
                    view.load(doc, vm.note?.pageCount ?: 1, vm.pageStyle)
                }

                if (vm.hasSelection) {
                    SelectionBar(
                        modifier = Modifier.align(Alignment.TopCenter).padding(12.dp),
                        onDelete = { inkView?.deleteSelection() },
                        onDuplicate = { inkView?.duplicateSelection() },
                        onCancel = { inkView?.clearSelection() },
                    )
                }

                AssistChip(
                    onClick = { inkView?.addPage(); vm.markDirty(::snapshot) },
                    label = { Text("＋ ページを追加") },
                    modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditorTopBar(
    vm: EditorViewModel,
    onBack: () -> Unit,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onAddPage: () -> Unit,
    onPageStyle: (PageStyle) -> Unit,
    onExportPng: () -> Unit,
    onClearAll: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    var paperMenu by remember { mutableStateOf(false) }

    TopAppBar(
        navigationIcon = {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "一覧へ戻る") }
        },
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BasicTitleField(vm)
                Spacer(Modifier.width(12.dp))
                Text(vm.saveState, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (vm.zoomPercent != 100) {
                    Spacer(Modifier.width(8.dp))
                    Text("${vm.zoomPercent}%", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        },
        actions = {
            IconButton(onClick = onUndo, enabled = vm.canUndo) { Icon(Icons.Default.Undo, "元に戻す") }
            IconButton(onClick = onRedo, enabled = vm.canRedo) { Icon(Icons.Default.Redo, "やり直す") }
            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "その他") }

            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("用紙の種類") }, onClick = { menu = false; paperMenu = true })
                DropdownMenuItem(text = { Text("ページを追加") }, onClick = { menu = false; onAddPage() })
                DropdownMenuItem(text = { Text("このページを画像で保存") }, onClick = { menu = false; onExportPng() })
                DropdownMenuItem(text = { Text("このメモを全部消す") }, onClick = { menu = false; onClearAll() })
            }
            DropdownMenu(expanded = paperMenu, onDismissRequest = { paperMenu = false }) {
                listOf(
                    PageStyle.PLAIN to "無地",
                    PageStyle.LINE to "横罫",
                    PageStyle.GRID to "方眼",
                    PageStyle.DOT to "ドット",
                ).forEach { (style, label) ->
                    DropdownMenuItem(text = { Text(label) }, onClick = { paperMenu = false; onPageStyle(style) })
                }
            }
        },
    )
}

@Composable
private fun BasicTitleField(vm: EditorViewModel) {
    TextField(
        value = vm.title,
        onValueChange = { vm.title = it },
        placeholder = { Text("無題のメモ") },
        singleLine = true,
        textStyle = TextStyle(fontWeight = FontWeight.Bold, fontSize = 16.sp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Color.Transparent,
            unfocusedContainerColor = Color.Transparent,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
        ),
        modifier = Modifier.widthIn(max = 260.dp),
    )
}

@Composable
private fun ToolPalette(vm: EditorViewModel, onFit: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier
            .width(64.dp)
            .fillMaxHeight()
            .background(MaterialTheme.colorScheme.surface)
            .verticalScroll(rememberScrollState())
            .padding(vertical = 10.dp),
    ) {
        ToolButton("🖊️", vm.tool == Tool.PEN) { vm.tool = Tool.PEN }
        ToolButton("🖍️", vm.tool == Tool.MARKER) { vm.tool = Tool.MARKER }
        ToolButton("🧽", vm.tool == Tool.ERASER) { vm.tool = Tool.ERASER }
        ToolButton("🔗", vm.tool == Tool.LASSO) { vm.tool = Tool.LASSO }

        HorizontalDivider(Modifier.width(32.dp).padding(vertical = 4.dp))

        PALETTE.forEach { c ->
            Box(
                Modifier
                    .size(30.dp)
                    .clip(CircleShape)
                    .background(c)
                    .border(
                        width = if (vm.color == c) 2.dp else 1.dp,
                        color = if (vm.color == c) MaterialTheme.colorScheme.primary else Color(0x33000000),
                        shape = CircleShape,
                    )
                    .clickableNoRipple { vm.color = c },
            )
        }

        HorizontalDivider(Modifier.width(32.dp).padding(vertical = 4.dp))

        val widths = if (vm.tool == Tool.MARKER) MARKER_WIDTHS else PEN_WIDTHS
        val selected = if (vm.tool == Tool.MARKER) vm.markerWidth else vm.penWidth
        widths.forEach { w ->
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(width = 40.dp, height = 28.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (selected == w) MaterialTheme.colorScheme.primary.copy(alpha = 0.15f) else Color.Transparent)
                    .clickableNoRipple {
                        if (vm.tool == Tool.MARKER) vm.markerWidth = w else vm.penWidth = w
                    },
            ) {
                Box(
                    Modifier
                        .width(24.dp)
                        .height((w * 0.7f).coerceIn(2f, 14f).dp)
                        .clip(RoundedCornerShape(50))
                        .background(MaterialTheme.colorScheme.onSurface),
                )
            }
        }

        HorizontalDivider(Modifier.width(32.dp).padding(vertical = 4.dp))

        ToolButton("👆", vm.fingerDraw) { vm.fingerDraw = !vm.fingerDraw }
        ToolButton("⤢", false) { onFit() }
    }
}

@Composable
private fun ToolButton(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(46.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.15f) else Color.Transparent)
            .clickableNoRipple(onClick),
    ) { Text(label, fontSize = 20.sp) }
}

@Composable
private fun SelectionBar(
    modifier: Modifier = Modifier,
    onDelete: () -> Unit,
    onDuplicate: () -> Unit,
    onCancel: () -> Unit,
) {
    Surface(modifier = modifier, shape = RoundedCornerShape(50), shadowElevation = 4.dp) {
        Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) {
            TextButton(onClick = onDelete) { Text("🗑 削除") }
            TextButton(onClick = onDuplicate) { Text("⧉ 複製") }
            TextButton(onClick = onCancel) { Text("✕ 解除") }
        }
    }
}

/** ツールバーは連打されるので、波紋アニメーションなしの軽いクリックにする */
@Composable
private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier = this.clickable(
    interactionSource = remember { MutableInteractionSource() },
    indication = null,
    onClick = onClick,
)
