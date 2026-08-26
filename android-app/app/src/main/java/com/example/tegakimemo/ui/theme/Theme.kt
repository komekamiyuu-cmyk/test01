package com.example.tegakimemo.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

val Accent = Color(0xFF3D7DFF)

private val LightColors = lightColorScheme(
    primary = Accent,
    background = Color(0xFFF5F5F7),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFEBEBEF),
    onSurface = Color(0xFF1C1C22),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF6F9DFF),
    background = Color(0xFF16171C),
    surface = Color(0xFF1F2027),
    surfaceVariant = Color(0xFF101116),
    onSurface = Color(0xFFECEEF4),
)

@Composable
fun TegakiTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkColors else LightColors
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colors.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }
    MaterialTheme(colorScheme = colors, content = content)
}
