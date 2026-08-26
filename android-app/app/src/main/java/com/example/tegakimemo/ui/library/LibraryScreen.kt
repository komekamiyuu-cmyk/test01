package com.example.tegakimemo.ui.library

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tegakimemo.data.FolderEntity
import com.example.tegakimemo.data.NoteEntity
import com.example.tegakimemo.ui.components.ConfirmDialog
import com.example.tegakimemo.ui.components.FolderPickerDialog
import com.example.tegakimemo.ui.components.TextInputDialog
import com.example.tegakimemo.ui.components.formatDate
import kotlinx.coroutines.launch
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(vm: LibraryViewModel, onOpenNote: (String) -> Unit) {
    val folders by vm.folders.collectAsState()
    val notes by vm.notes.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }

    var newFolderDialog by remember { mutableStateOf(false) }
    var renameFolder by remember { mutableStateOf<FolderEntity?>(null) }
    var subFolderOf by remember { mutableStateOf<FolderEntity?>(null) }
    var moveFolderTarget by remember { mutableStateOf<FolderEntity?>(null) }
    var deleteFolderTarget by remember { mutableStateOf<FolderEntity?>(null) }
    var renameNoteTarget by remember { mutableStateOf<NoteEntity?>(null) }
    var moveNoteTarget by remember { mutableStateOf<NoteEntity?>(null) }
    var deleteNoteTarget by remember { mutableStateOf<NoteEntity?>(null) }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val text = vm.exportJson()
            context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) }
            snackbar.showSnackbar("バックアップを書き出しました")
        }
    }
    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val text = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
        if (text != null) vm.importJson(text) { msg -> scope.launch { snackbar.showSnackbar(msg) } }
    }

    val pane: @Composable () -> Unit = {
        FolderPane(
            vm = vm,
            folders = folders,
            totalNotes = notes.size,
            onNewFolder = { newFolderDialog = true },
            onRename = { renameFolder = it },
            onSubFolder = { subFolderOf = it },
            onMove = { moveFolderTarget = it },
            onDelete = { deleteFolderTarget = it },
            onExport = { exportLauncher.launch("tegaki-memo-backup.json") },
            onImport = { importLauncher.launch(arrayOf("application/json")) },
        )
    }

    BoxWithConstraints {
        val wide = maxWidth >= 720.dp
        val drawerState = rememberDrawerState(DrawerValue.Closed)

        val content: @Composable () -> Unit = {
            Scaffold(
                snackbarHost = { SnackbarHost(snackbar) },
                topBar = {
                    LibraryTopBar(
                        title = if (vm.query.isBlank()) vm.folderPath(vm.currentFolderId) else "「${vm.query}」の検索結果",
                        showMenu = !wide,
                        onMenu = { scope.launch { drawerState.open() } },
                        sort = vm.sort,
                        onSort = { vm.sort = it },
                        onNewNote = { vm.createNote(onOpenNote) },
                    )
                },
            ) { padding ->
                NoteGrid(
                    notes = vm.visibleNotes(),
                    modifier = Modifier.padding(padding),
                    onOpen = onOpenNote,
                    onRename = { renameNoteTarget = it },
                    onMove = { moveNoteTarget = it },
                    onDuplicate = { vm.duplicateNote(it) },
                    onDelete = { deleteNoteTarget = it },
                    onNewNote = { vm.createNote(onOpenNote) },
                )
            }
        }

        if (wide) {
            Row(Modifier.fillMaxSize()) {
                Surface(
                    modifier = Modifier.width(280.dp).fillMaxHeight(),
                    color = MaterialTheme.colorScheme.surface,
                ) { pane() }
                Box(Modifier.weight(1f)) { content() }
            }
        } else {
            ModalNavigationDrawer(
                drawerState = drawerState,
                drawerContent = { ModalDrawerSheet { pane() } },
            ) { content() }
        }
    }

    /* ---------- ダイアログ ---------- */

    if (newFolderDialog) {
        TextInputDialog("新しいフォルダ", "", "作成", onDismiss = { newFolderDialog = false }) {
            vm.createFolder(it); newFolderDialog = false
        }
    }
    renameFolder?.let { f ->
        TextInputDialog("フォルダ名", f.name, "変更", onDismiss = { renameFolder = null }) {
            vm.renameFolder(f, it); renameFolder = null
        }
    }
    subFolderOf?.let { f ->
        TextInputDialog("サブフォルダ名", "", "作成", onDismiss = { subFolderOf = null }) {
            vm.createSubFolder(f, it); subFolderOf = null
        }
    }
    moveFolderTarget?.let { f ->
        FolderPickerDialog(
            title = "移動先を選ぶ",
            folders = folders,
            excluded = setOf(f.id) + vm.descendantIds(f.id),
            onDismiss = { moveFolderTarget = null },
        ) { dest -> vm.moveFolder(f, dest); moveFolderTarget = null }
    }
    deleteFolderTarget?.let { f ->
        ConfirmDialog(
            title = "フォルダを削除",
            message = "「${f.name}」を削除します。中のメモとサブフォルダは親フォルダに移動します。",
            confirmLabel = "削除",
            onDismiss = { deleteFolderTarget = null },
        ) { vm.deleteFolder(f); deleteFolderTarget = null }
    }
    renameNoteTarget?.let { n ->
        TextInputDialog("メモの名前", n.title, "変更", onDismiss = { renameNoteTarget = null }) {
            vm.renameNote(n, it); renameNoteTarget = null
        }
    }
    moveNoteTarget?.let { n ->
        FolderPickerDialog(
            title = "移動先を選ぶ",
            folders = folders,
            excluded = emptySet(),
            onDismiss = { moveNoteTarget = null },
        ) { dest -> vm.moveNote(n, dest); moveNoteTarget = null }
    }
    deleteNoteTarget?.let { n ->
        ConfirmDialog(
            title = "メモを削除",
            message = "「${n.title.ifBlank { "無題のメモ" }}」を削除します。元に戻せません。",
            confirmLabel = "削除",
            onDismiss = { deleteNoteTarget = null },
        ) { vm.deleteNote(n); deleteNoteTarget = null }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LibraryTopBar(
    title: String,
    showMenu: Boolean,
    onMenu: () -> Unit,
    sort: SortOrder,
    onSort: (SortOrder) -> Unit,
    onNewNote: () -> Unit,
) {
    TopAppBar(
        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = {
            if (showMenu) IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, "フォルダ") }
        },
        actions = {
            var open by remember { mutableStateOf(false) }
            TextButton(onClick = { open = true }) { Text(sort.label) }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                SortOrder.entries.forEach { s ->
                    DropdownMenuItem(text = { Text(s.label) }, onClick = { onSort(s); open = false })
                }
            }
            Button(onClick = onNewNote, modifier = Modifier.padding(end = 12.dp)) {
                Icon(Icons.Default.Add, null)
                Spacer(Modifier.width(4.dp))
                Text("新規メモ")
            }
        },
    )
}

@Composable
private fun FolderPane(
    vm: LibraryViewModel,
    folders: List<FolderEntity>,
    totalNotes: Int,
    onNewFolder: () -> Unit,
    onRename: (FolderEntity) -> Unit,
    onSubFolder: (FolderEntity) -> Unit,
    onMove: (FolderEntity) -> Unit,
    onDelete: (FolderEntity) -> Unit,
    onExport: () -> Unit,
    onImport: () -> Unit,
) {
    Column(Modifier.fillMaxHeight().padding(horizontal = 8.dp)) {
        Text(
            "✍️ てがきメモ",
            fontWeight = FontWeight.Bold,
            fontSize = 18.sp,
            modifier = Modifier.padding(start = 8.dp, top = 16.dp, bottom = 8.dp),
        )
        OutlinedTextField(
            value = vm.query,
            onValueChange = { vm.query = it },
            placeholder = { Text("メモを検索") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        )

        LazyColumn(Modifier.weight(1f)) {
            item {
                FolderRow("🗂 すべてのメモ", totalNotes, 0, false, null,
                    selected = vm.currentFolderId == null,
                    onClick = { vm.selectFolder(null) })
            }
            // 入れ子フォルダを開いている分だけ平らに並べる
            val rows = mutableListOf<Pair<FolderEntity, Int>>()
            fun walk(parentId: String?, depth: Int) {
                vm.childFolders(parentId).forEach { f ->
                    rows.add(f to depth)
                    if (vm.expanded[f.id] == true) walk(f.id, depth + 1)
                }
            }
            walk(null, 0)

            items(rows.size) { i ->
                val (folder, depth) = rows[i]
                val hasChildren = vm.childFolders(folder.id).isNotEmpty()
                FolderRow(
                    label = (if (vm.expanded[folder.id] == true) "📂 " else "📁 ") + folder.name,
                    count = vm.countIn(folder.id),
                    depth = depth,
                    hasChildren = hasChildren,
                    folder = folder,
                    selected = vm.currentFolderId == folder.id,
                    onClick = { vm.selectFolder(folder.id) },
                    onToggle = { vm.toggleExpanded(folder.id) },
                    expanded = vm.expanded[folder.id] == true,
                    onRename = onRename,
                    onSubFolder = onSubFolder,
                    onMove = onMove,
                    onDelete = onDelete,
                )
            }
        }

        HorizontalDivider()
        TextButton(onClick = onNewFolder, modifier = Modifier.fillMaxWidth()) { Text("＋ 新しいフォルダ") }
        Row(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
            TextButton(onClick = onExport, modifier = Modifier.weight(1f)) { Text("⬇ バックアップ") }
            TextButton(onClick = onImport, modifier = Modifier.weight(1f)) { Text("⬆ 復元") }
        }
    }
}

@Composable
private fun FolderRow(
    label: String,
    count: Int,
    depth: Int,
    hasChildren: Boolean,
    folder: FolderEntity?,
    selected: Boolean,
    onClick: () -> Unit,
    onToggle: () -> Unit = {},
    expanded: Boolean = false,
    onRename: (FolderEntity) -> Unit = {},
    onSubFolder: (FolderEntity) -> Unit = {},
    onMove: (FolderEntity) -> Unit = {},
    onDelete: (FolderEntity) -> Unit = {},
) {
    var menu by remember { mutableStateOf(false) }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = (depth * 14).dp, top = 2.dp, bottom = 2.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick)
            .heightIn(min = 44.dp),
    ) {
        if (hasChildren) {
            IconButton(onClick = onToggle, modifier = Modifier.size(28.dp)) {
                Icon(
                    if (expanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                    contentDescription = if (expanded) "閉じる" else "開く",
                    modifier = Modifier.size(18.dp),
                )
            }
        } else {
            Spacer(Modifier.width(28.dp))
        }
        Text(
            label,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
        )
        Text("$count", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (folder != null) {
            IconButton(onClick = { menu = true }, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Default.MoreVert, "フォルダの操作", modifier = Modifier.size(18.dp))
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("名前を変更") }, onClick = { menu = false; onRename(folder) })
                DropdownMenuItem(text = { Text("サブフォルダを作る") }, onClick = { menu = false; onSubFolder(folder) })
                DropdownMenuItem(text = { Text("別のフォルダへ移動") }, onClick = { menu = false; onMove(folder) })
                DropdownMenuItem(text = { Text("削除(中身は親へ)") }, onClick = { menu = false; onDelete(folder) })
            }
        } else {
            Spacer(Modifier.width(8.dp))
        }
    }
}

@Composable
private fun NoteGrid(
    notes: List<NoteEntity>,
    modifier: Modifier = Modifier,
    onOpen: (String) -> Unit,
    onRename: (NoteEntity) -> Unit,
    onMove: (NoteEntity) -> Unit,
    onDuplicate: (NoteEntity) -> Unit,
    onDelete: (NoteEntity) -> Unit,
    onNewNote: () -> Unit,
) {
    if (notes.isEmpty()) {
        Column(
            modifier = modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("📝", fontSize = 52.sp)
            Spacer(Modifier.height(8.dp))
            Text("まだメモがありません", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(16.dp))
            Button(onClick = onNewNote) { Text("＋ 最初のメモを作る") }
        }
        return
    }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(190.dp),
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        items(notes, key = { it.id }) { note ->
            NoteCard(note, onOpen, onRename, onMove, onDuplicate, onDelete)
        }
    }
}

@Composable
private fun NoteCard(
    note: NoteEntity,
    onOpen: (String) -> Unit,
    onRename: (NoteEntity) -> Unit,
    onMove: (NoteEntity) -> Unit,
    onDuplicate: (NoteEntity) -> Unit,
    onDelete: (NoteEntity) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val thumb = remember(note.thumbPath, note.updatedAt) {
        note.thumbPath?.takeIf { File(it).exists() }?.let { BitmapFactory.decodeFile(it)?.asImageBitmap() }
    }

    Card(onClick = { onOpen(note.id) }) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(3f / 4f)
                .background(androidx.compose.ui.graphics.Color.White),
        ) {
            if (thumb != null) {
                Image(thumb, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp)) {
            Column(Modifier.weight(1f)) {
                Text(
                    note.title.ifBlank { "無題のメモ" },
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(formatDate(note.updatedAt), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "メモの操作") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("名前を変更") }, onClick = { menu = false; onRename(note) })
                DropdownMenuItem(text = { Text("フォルダへ移動") }, onClick = { menu = false; onMove(note) })
                DropdownMenuItem(text = { Text("複製") }, onClick = { menu = false; onDuplicate(note) })
                DropdownMenuItem(text = { Text("削除") }, onClick = { menu = false; onDelete(note) })
            }
        }
    }
}
