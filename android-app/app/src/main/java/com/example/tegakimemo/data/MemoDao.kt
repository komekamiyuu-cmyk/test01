package com.example.tegakimemo.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface MemoDao {

    /* ---------- フォルダ ---------- */

    @Query("SELECT * FROM folders ORDER BY name")
    fun observeFolders(): Flow<List<FolderEntity>>

    @Upsert
    suspend fun upsertFolder(folder: FolderEntity)

    @Query("DELETE FROM folders WHERE id = :id")
    suspend fun deleteFolder(id: String)

    /** 削除するフォルダの中身は、消さずに親フォルダへ引き上げる */
    @Query("UPDATE folders SET parentId = :newParentId WHERE parentId = :folderId")
    suspend fun reparentChildFolders(folderId: String, newParentId: String?)

    @Query("UPDATE notes SET folderId = :newFolderId WHERE folderId = :folderId")
    suspend fun reparentNotes(folderId: String, newFolderId: String?)

    /* ---------- メモ ---------- */

    @Query("SELECT * FROM notes ORDER BY updatedAt DESC")
    fun observeNotes(): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE id = :id")
    suspend fun getNote(id: String): NoteEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNote(note: NoteEntity)

    @Update
    suspend fun updateNote(note: NoteEntity)

    @Query("DELETE FROM notes WHERE id = :id")
    suspend fun deleteNote(id: String)

    /* ---------- 手書き本体 ---------- */

    @Query("SELECT * FROM note_docs WHERE noteId = :noteId")
    suspend fun getDoc(noteId: String): NoteDocEntity?

    @Upsert
    suspend fun upsertDoc(doc: NoteDocEntity)
}
