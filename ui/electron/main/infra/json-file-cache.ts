import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CachedAnswer, CachedAnswerStore } from '../services/ports'

/**
 * A cached server answer in one JSON file. Written to a temporary file and renamed, so a crash mid-write never
 * leaves half a file; a missing, unreadable or malformed file reads as "no cache".
 */
export class JsonFileCache<T> implements CachedAnswerStore<T> {
  constructor(private readonly file: string) {}

  async read(): Promise<CachedAnswer<T> | null> {
    try {
      const entry = JSON.parse(await readFile(this.file, 'utf8')) as Partial<CachedAnswer<T>>
      return typeof entry.source === 'string' && typeof entry.etag === 'string' && entry.data !== undefined ? (entry as CachedAnswer<T>) : null
    } catch {
      return null
    }
  }

  async write(entry: CachedAnswer<T>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(entry))
    await rename(tmp, this.file)
  }
}
