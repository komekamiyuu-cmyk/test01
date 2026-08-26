package com.example.tegakimemo.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [FolderEntity::class, NoteEntity::class, NoteDocEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class MemoDatabase : RoomDatabase() {
    abstract fun memoDao(): MemoDao

    companion object {
        @Volatile private var instance: MemoDatabase? = null

        fun get(context: Context): MemoDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                MemoDatabase::class.java,
                "tegaki-memo.db",
            ).build().also { instance = it }
        }
    }
}
