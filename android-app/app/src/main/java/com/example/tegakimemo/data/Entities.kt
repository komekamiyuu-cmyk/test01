package com.example.tegakimemo.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable
import java.util.UUID

@Serializable
@Entity(tableName = "folders")
data class FolderEntity(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val name: String,
    /** 入れ子フォルダ。ルート直下は null */
    val parentId: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
)

@Serializable
@Entity(
    tableName = "notes",
    indices = [Index("folderId"), Index("updatedAt")],
)
data class NoteEntity(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val title: String = "",
    val folderId: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val pageStyle: String = "LINE",
    val pageCount: Int = 1,
    /** 一覧に出すサムネイル画像(内部ストレージ上のパス) */
    val thumbPath: String? = null,
)

/**
 * 手書きの本体。一覧画面では読み込まなくて済むよう、メモ本体とはテーブルを分けている。
 * strokesJson は InkDocument を kotlinx.serialization で文字列にしたもの。
 */
@Serializable
@Entity(
    tableName = "note_docs",
    foreignKeys = [
        ForeignKey(
            entity = NoteEntity::class,
            parentColumns = ["id"],
            childColumns = ["noteId"],
            onDelete = ForeignKey.CASCADE,
        )
    ],
)
data class NoteDocEntity(
    @PrimaryKey val noteId: String,
    val strokesJson: String,
)
