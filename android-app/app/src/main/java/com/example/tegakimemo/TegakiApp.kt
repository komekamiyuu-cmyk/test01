package com.example.tegakimemo

import android.app.Application
import com.example.tegakimemo.data.MemoDatabase
import com.example.tegakimemo.data.MemoRepository

/** 依存をひとまとめにする最小構成のコンテナ(プロトタイプなので DI ライブラリは使わない)。 */
class TegakiApp : Application() {
    val repository: MemoRepository by lazy {
        MemoRepository(this, MemoDatabase.get(this).memoDao())
    }
}
