package com.phonedek.app.data

import android.content.Context
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Last good config, kept as raw JSON so newer desktop fields survive a cache round-trip. */
class ConfigCache(context: Context) {
    private val directory = File(context.filesDir, "cache")
    private val file = File(directory, "deck-config.json")
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

    suspend fun clear() = withContext(Dispatchers.IO) {
        mutex.withLock {
            runCatching {
                file.delete()
                File(directory, "deck-config.json.tmp").delete()
            }
        }
    }
}
