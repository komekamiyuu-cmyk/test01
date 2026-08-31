# JavaScript から呼ばれる窓口はリフレクション経由なので難読化・削除しない
-keepclassmembers class io.github.komekamiyuu.cassette.MainActivity$Bridge {
    public *;
}
