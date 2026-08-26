package com.example.tegakimemo.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.tegakimemo.data.FolderEntity
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

@Composable
fun TextInputDialog(
    title: String,
    initial: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { if (text.isNotBlank()) onConfirm(text.trim()) },
                enabled = text.isNotBlank(),
            ) { Text(confirmLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("キャンセル") } },
    )
}

@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirmLabel, color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("キャンセル") } },
    )
}

/** 移動先フォルダを選ぶ。null は「フォルダなし(すべてのメモ)」。 */
@Composable
fun FolderPickerDialog(
    title: String,
    folders: List<FolderEntity>,
    excluded: Set<String>,
    onDismiss: () -> Unit,
    onPick: (String?) -> Unit,
) {
    val rows = remember(folders, excluded) {
        val out = mutableListOf<Pair<FolderEntity, Int>>()
        fun walk(parentId: String?, depth: Int) {
            folders.filter { it.parentId == parentId }.sortedBy { it.name }.forEach { f ->
                if (f.id !in excluded) out.add(f to depth)
                walk(f.id, depth + 1)
            }
        }
        walk(null, 0)
        out
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
                TextButton(onClick = { onPick(null) }, modifier = Modifier.fillMaxWidth()) {
                    Text("🗂 すべてのメモ(フォルダなし)")
                }
                rows.forEach { (folder, depth) ->
                    TextButton(onClick = { onPick(folder.id) }, modifier = Modifier.fillMaxWidth()) {
                        Text("　".repeat(depth) + "📁 " + folder.name)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("キャンセル") } },
    )
}

fun formatDate(timestamp: Long): String {
    val cal = Calendar.getInstance()
    val today = cal.get(Calendar.DAY_OF_YEAR)
    val year = cal.get(Calendar.YEAR)
    cal.timeInMillis = timestamp
    val sameDay = cal.get(Calendar.DAY_OF_YEAR) == today && cal.get(Calendar.YEAR) == year
    val pattern = if (sameDay) "'今日' HH:mm" else "yyyy/MM/dd HH:mm"
    return SimpleDateFormat(pattern, Locale.JAPAN).format(Date(timestamp))
}
