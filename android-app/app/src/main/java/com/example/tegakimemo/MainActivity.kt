package com.example.tegakimemo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.example.tegakimemo.ui.editor.EditorScreen
import com.example.tegakimemo.ui.editor.EditorViewModel
import com.example.tegakimemo.ui.library.LibraryScreen
import com.example.tegakimemo.ui.library.LibraryViewModel
import com.example.tegakimemo.ui.theme.TegakiTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repo = (application as TegakiApp).repository

        val factory = viewModelFactory {
            initializer { LibraryViewModel(repo) }
            initializer { EditorViewModel(repo) }
        }

        setContent {
            TegakiTheme {
                val libraryVm: LibraryViewModel = viewModel(factory = factory)
                val editorVm: EditorViewModel = viewModel(factory = factory)
                var openNoteId by rememberSaveable { mutableStateOf<String?>(null) }

                if (openNoteId == null) {
                    LibraryScreen(libraryVm) { id ->
                        openNoteId = id
                        editorVm.open(id)
                    }
                } else {
                    EditorScreen(editorVm) {
                        editorVm.close()
                        openNoteId = null
                    }
                }
            }
        }
    }
}
