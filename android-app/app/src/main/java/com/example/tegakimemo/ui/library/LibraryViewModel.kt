package com.example.tegakimemo.ui.library

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tegakimemo.data.FolderEntity
import com.example.tegakimemo.data.MemoRepository
import com.example.tegakimemo.data.NoteEntity
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class SortOrder(val label: String) { UPDATED("更新順"), CREATED("作成順"), TITLE("名前順") }

class LibraryViewModel(private val repo: MemoRepository) : ViewModel() {

    val folders: StateFlow<List<FolderEntity>> =
        repo.folders.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val notes: StateFlow<List<NoteEntity>> =
        repo.notes.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** null = すべてのメモ */
    var currentFolderId by mutableStateOf<String?>(null)
        private set
    var query by mutableStateOf("")
    var sort by mutableStateOf(SortOrder.UPDATED)
    val expanded = mutableStateMapOf<String, Boolean>()

    fun selectFolder(id: String?) { currentFolderId = id }

    fun toggleExpanded(id: String) { expanded[id] = expanded[id] != true }

    fun childFolders(parentId: String?): List<FolderEntity> =
        folders.value.filter { it.parentId == parentId }.sortedBy { it.name }

    fun descendantIds(id: String): List<String> {
        val out = mutableListOf<String>()
        fun walk(pid: String) {
            childFolders(pid).forEach { out.add(it.id); walk(it.id) }
        }
        walk(id)
        return out
    }

    fun countIn(folderId: String): Int {
        val ids = setOf(folderId) + descendantIds(folderId)
        return notes.value.count { it.folderId in ids }
    }

    fun folderPath(id: String?): String {
        if (id == null) return "すべてのメモ"
        val map = folders.value.associateBy { it.id }
        val names = mutableListOf<String>()
        var cur = map[id]
        while (cur != null) {
            names.add(0, cur.name)
            cur = cur.parentId?.let(map::get)
        }
        return names.joinToString(" / ")
    }

    /** 一覧に出すメモ。検索中は全フォルダから探す。 */
    fun visibleNotes(): List<NoteEntity> {
        val base = if (query.isBlank()) {
            notes.value.filter { it.folderId == currentFolderId }
        } else {
            notes.value.filter { it.title.ifBlank { "無題のメモ" }.contains(query, ignoreCase = true) }
        }
        return when (sort) {
            SortOrder.UPDATED -> base.sortedByDescending { it.updatedAt }
            SortOrder.CREATED -> base.sortedByDescending { it.createdAt }
            SortOrder.TITLE -> base.sortedBy { it.title.ifBlank { "無題のメモ" } }
        }
    }

    /* ---------- 操作 ---------- */

    fun createFolder(name: String) = viewModelScope.launch {
        val parent = currentFolderId
        val folder = repo.createFolder(name, parent)
        parent?.let { expanded[it] = true }
        currentFolderId = folder.id
    }

    fun createSubFolder(parent: FolderEntity, name: String) = viewModelScope.launch {
        repo.createFolder(name, parent.id)
        expanded[parent.id] = true
    }

    fun renameFolder(folder: FolderEntity, name: String) = viewModelScope.launch {
        repo.renameFolder(folder, name)
    }

    fun moveFolder(folder: FolderEntity, newParentId: String?) = viewModelScope.launch {
        // 自分の子孫の下には入れられない
        if (newParentId != null && (newParentId == folder.id || newParentId in descendantIds(folder.id))) return@launch
        repo.moveFolder(folder, newParentId)
    }

    fun deleteFolder(folder: FolderEntity) = viewModelScope.launch {
        repo.deleteFolder(folder)
        if (currentFolderId == folder.id) currentFolderId = folder.parentId
    }

    fun createNote(onCreated: (String) -> Unit) = viewModelScope.launch {
        val note = repo.createNote(currentFolderId)
        onCreated(note.id)
    }

    fun renameNote(note: NoteEntity, title: String) = viewModelScope.launch {
        repo.updateNote(note.copy(title = title))
    }

    fun moveNote(note: NoteEntity, folderId: String?) = viewModelScope.launch {
        repo.updateNote(note.copy(folderId = folderId))
    }

    fun duplicateNote(note: NoteEntity) = viewModelScope.launch { repo.duplicateNote(note) }

    fun deleteNote(note: NoteEntity) = viewModelScope.launch { repo.deleteNote(note) }

    suspend fun exportJson(): String = repo.exportJson(folders.value, notes.value)

    fun importJson(text: String, onError: (String) -> Unit) = viewModelScope.launch {
        runCatching { repo.importJson(text) }.onFailure { onError(it.message ?: "読み込みに失敗しました") }
    }
}
