package com.example.tegakimemo.ui.editor

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tegakimemo.data.MemoRepository
import com.example.tegakimemo.data.NoteEntity
import com.example.tegakimemo.ink.InkDocument
import com.example.tegakimemo.ink.PageStyle
import com.example.tegakimemo.ink.Tool
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** 保存時にビューから受け取る内容 */
data class EditorSnapshot(
    val doc: InkDocument,
    val pageCount: Int,
    val pageStyle: PageStyle,
)

class EditorViewModel(private val repo: MemoRepository) : ViewModel() {

    var note by mutableStateOf<NoteEntity?>(null)
        private set
    /** 読み込みが終わった手書きデータ。ビューはこれを見て load する。 */
    var loadedDoc by mutableStateOf<InkDocument?>(null)
        private set
    var title by mutableStateOf("")
    var saveState by mutableStateOf("保存済み")
        private set

    /* 道具の状態(メモを閉じても保持する) */
    var tool by mutableStateOf(Tool.PEN)
    var color by mutableStateOf(Color(0xFF1C1C22))
    var penWidth by mutableStateOf(3f)
    var markerWidth by mutableStateOf(22f)
    var fingerDraw by mutableStateOf(false)
    var pageStyle by mutableStateOf(PageStyle.LINE)

    var canUndo by mutableStateOf(false)
    var canRedo by mutableStateOf(false)
    var hasSelection by mutableStateOf(false)
    var zoomPercent by mutableStateOf(100)

    private var saveJob: Job? = null
    private var lastThumbAt = 0L

    fun open(noteId: String) {
        loadedDoc = null
        viewModelScope.launch {
            val n = repo.getNote(noteId) ?: return@launch
            note = n
            title = n.title
            pageStyle = runCatching { PageStyle.valueOf(n.pageStyle) }.getOrDefault(PageStyle.LINE)
            saveState = "保存済み"
            loadedDoc = repo.loadDoc(noteId)
        }
    }

    /** 変更があったときに呼ぶ。連続入力でも書き込みが増えないよう少し待ってから保存する。 */
    fun markDirty(snapshot: () -> EditorSnapshot) {
        saveState = "保存中…"
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(700)
            persist(snapshot(), force = false)
        }
    }

    /** 画面を閉じるときなど、すぐ保存したいとき */
    fun saveNow(snapshot: EditorSnapshot, onDone: () -> Unit = {}) {
        saveJob?.cancel()
        viewModelScope.launch {
            persist(snapshot, force = true)
            onDone()
        }
    }

    private suspend fun persist(snapshot: EditorSnapshot, force: Boolean) {
        val n = note ?: return
        val now = System.currentTimeMillis()
        // サムネイル生成は重いので、閉じるときと数秒に1回だけ
        val renew = force || now - lastThumbAt > 4_000
        if (renew) lastThumbAt = now
        note = repo.saveDoc(
            note = n,
            doc = snapshot.doc,
            pageCount = snapshot.pageCount,
            pageStyle = snapshot.pageStyle,
            title = title,
            renewThumbnail = renew,
        )
        saveState = "保存済み"
    }

    fun close() {
        saveJob?.cancel()
        note = null
        loadedDoc = null
    }
}
