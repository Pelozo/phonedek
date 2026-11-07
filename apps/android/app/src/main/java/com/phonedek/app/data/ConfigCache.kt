package com.phonedek.app.data

import android.content.Context
import com.phonedek.app.util.Diag
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

private const val MAX_CACHE_ARCHIVES = 5

/** Last good config, kept as raw JSON so newer desktop fields survive a cache round-trip. */
class ConfigCache(context: Context) {
    private val directory = File(context.filesDir, "cache")
    private val file = File(directory, "deck-config.json")
    private val backupsDirectory = File(context.filesDir, "backups")
    private val mutex = Mutex()

    suspend fun read(): String? = withContext(Dispatchers.IO) {
        runCatching {
            if (file.isFile) file.readText().takeIf { it.isNotBlank() } else null
        }.getOrNull()
    }

    suspend fun write(raw: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            runCatching {
                directory.mkdirs()
                val temp = File(directory, "deck-config.json.tmp")
                temp.writeText(raw)
                if (!temp.renameTo(file)) {
                    file.writeText(raw)
                    temp.delete()
                }
            }
        }
    }

    /**
     * Best-effort copy of the current cached JSON for change-server safety.
     * Failure or a missing cache never blocks the caller.
     */
    suspend fun archive(reason: String = "manual"): File? = withContext(Dispatchers.IO) {
        mutex.withLock {
            val raw = runCatching {
                if (file.isFile) file.readText().takeIf { it.isNotBlank() } else null
            }.getOrNull()
            if (raw == null) return@withLock null

            runCatching {
                backupsDirectory.mkdirs()
                val timestamp = SimpleDateFormat(
                    "yyyyMMdd-HHmmss-SSS",
                    Locale.US,
                ).format(Date())
                var target = File(backupsDirectory, "cache-$timestamp.json")
                var suffix = 2
                while (target.exists()) {
                    target = File(backupsDirectory, "cache-$timestamp-$suffix.json")
                    suffix++
                }
                target.writeText(raw)
                pruneCacheArchives(backupsDirectory, MAX_CACHE_ARCHIVES)
                Diag.i("Archived cached config ($reason) as ${target.name}")
                target
            }.onFailure {
                Diag.w("Could not archive cached config ($reason): ${it.message}")
            }.getOrNull()
        }
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        mutex.withLock {
            runCatching {
                file.delete()
                File(directory, "deck-config.json.tmp").delete()
            }
        }
    }
}

/**
 * Keeps the lexicographically newest `cache-*.json` archives. The timestamp in
 * the filename makes that ordering chronological. Returns deleted count.
 */
internal fun pruneCacheArchives(directory: File, keep: Int = MAX_CACHE_ARCHIVES): Int {
    if (keep < 0) return 0
    val archives = directory.listFiles { entry ->
        entry.isFile &&
            entry.name.startsWith("cache-") &&
            entry.name.endsWith(".json")
    }?.sortedWith(
        compareByDescending<File> { it.lastModified() }
            .thenByDescending { it.name },
    ) ?: return 0
    var deleted = 0
    archives.drop(keep).forEach { archive ->
        if (archive.delete()) deleted++
    }
    return deleted
}
