# kotlinx.serialization のシリアライザは反射で参照されるため残す
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class * { @kotlinx.serialization.Serializable <fields>; }
