package com.example.tegakimemo.data

import android.content.Context
import com.example.tegakimemo.ink.InkDocument
import com.example.tegakimemo.ink.PageStyle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID

/** メモとフォルダの読み書きを一手に引き受ける層。 */
class MemoRepository(
    private val context: Context,
    private val dao: MemoDao,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val thumbDir: File get() = File(context.filesDir, "thumbs")

    val folders: Flow<List<FolderEntity>> = dao.observeFolders()
    val notes: Flow<List<NoteEntity>> = dao.observeNotes()

    /* ---------- フォルダ ---------- */

    suspend fun createFolder(name: String, parentId: String?): FolderEntity {
        val folder = FolderEntity(name = name, parentId = parentId)
        dao.upsertFolder(folder)
        return folder
    }

    suspend fun renameFolder(folder: FolderEntity, name: String) =
        dao.upsertFolder(folder.copy(name = name))

    suspend fun moveFolder(folder: FolderEntity, newParentId: String?) =
        dao.upsertFolder(folder.copy(parentId = newParentId))

    /** フォルダを消しても中身は消さない。親フォルダへ引き上げる。 */
    suspend fun deleteFolder(folder: FolderEntity) {
        dao.reparentChildFolders(folder.id, folder.parentId)
        dao.reparentNotes(folder.id, folder.parentId)
        dao.deleteFolder(folder.id)
    }

    /* ---------- メモ ---------- */

    suspend fun createNote(folderId: String?): NoteEntity {
        val note = NoteEntity(folderId = folderId)
        dao.insertNote(note)
        dao.upsertDoc(NoteDocEntity(note.id, json.encodeToString(InkDocument())))
        return note
    }

    suspend fun updateNote(note: NoteEntity) =
        dao.updateNote(note.copy(updatedAt = System.currentTimeMillis()))

    suspend fun deleteNote(note: NoteEntity) {
        note.thumbPath?.let { runCatching { File(it).delete() } }
        dao.deleteNote(note.id)           // note_docs は ForeignKey の CASCADE で一緒に消える
    }

    suspend fun duplicateNote(note: NoteEntity): NoteEntity {
        val copy = note.copy(
            id = UUID.randomUUID().toString(),
            title = (note.title.ifBlank { "無題のメモ" }) + " のコピー",
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            thumbPath = null,
        )
        dao.insertNote(copy)
        val doc = dao.getDoc(note.id)?.strokesJson ?: json.encodeToString(InkDocument())
        dao.upsertDoc(NoteDocEntity(copy.id, doc))
        return copy
    }

    suspend fun getNote(id: String): NoteEntity? = dao.getNote(id)

    /* ---------- 手書き本体 ---------- */

    suspend fun loadDoc(noteId: String): InkDocument = withContext(Dispatchers.IO) {
        val row = dao.getDoc(noteId) ?: return@withContext InkDocument()
        runCatching { json.decodeFromString<InkDocument>(row.strokesJson).prepare() }
            .getOrElse { InkDocument() }
    }

    /**
     * 手書きを保存する。サムネイルは書き出しが重いので、必要なときだけ作り直す。
     */
    suspend fun saveDoc(
        note: NoteEntity,
        doc: InkDocument,
        pageCount: Int,
        pageStyle: PageStyle,
        title: String,
        renewThumbnail: Boolean,
    ): NoteEntity = withContext(Dispatchers.IO) {
        dao.upsertDoc(NoteDocEntity(note.id, json.encodeToString(doc)))

        var thumbPath = note.thumbPath
        if (renewThumbnail) {
            thumbPath = runCatching {
                ThumbnailRenderer.save(thumbDir, note.id, ThumbnailRenderer.render(doc.strokes, pageStyle))
            }.getOrNull() ?: thumbPath
        }

        val updated = note.copy(
            title = title,
            pageCount = pageCount,
            pageStyle = pageStyle.name,
            thumbPath = thumbPath,
            updatedAt = System.currentTimeMillis(),
        )
        dao.updateNote(updated)
        updated
    }

    /* ---------- バックアップ ---------- */

    @Serializable
    data class Backup(
        val app: String = "tegaki-memo",
        val version: Int = 1,
        val folders: List<FolderEntity>,
        val notes: List<NoteEntity>,
        val docs: List<NoteDocEntity>,
    )

    suspend fun exportJson(
        folderList: List<FolderEntity>,
        noteList: List<NoteEntity>,
    ): String = withContext(Dispatchers.IO) {
        val docs = noteList.mapNotNull { dao.getDoc(it.id) }
        json.encodeToString(Backup(folders = folderList, notes = noteList, docs = docs))
    }

    /** 追加インポート。ID がぶつからないよう付け替えてから入れる。 */
    suspend fun importJson(text: String) = withContext(Dispatchers.IO) {
        val backup = json.decodeFromString<Backup>(text)
        require(backup.app == "tegaki-memo") { "てがきメモのバックアップではありません" }

        val folderIds = backup.folders.associate { it.id to UUID.randomUUID().toString() }
        val noteIds = backup.notes.associate { it.id to UUID.randomUUID().toString() }

        backup.folders.forEach { f ->
            dao.upsertFolder(f.copy(id = folderIds.getValue(f.id), parentId = f.parentId?.let(folderIds::get)))
        }
        backup.notes.forEach { n ->
            dao.insertNote(
                n.copy(
                    id = noteIds.getValue(n.id),
                    folderId = n.folderId?.let(folderIds::get),
                    thumbPath = null,
                )
            )
        }
        backup.docs.forEach { d ->
            noteIds[d.noteId]?.let { dao.upsertDoc(NoteDocEntity(it, d.strokesJson)) }
        }
    }
}
