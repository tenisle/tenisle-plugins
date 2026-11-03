/**
 * Credential storage for the Tenisle plugin.
 *
 * One JSON document under the harness home keeps the dynamically registered
 * OAuth client and the current token set. The file is written atomically with
 * `0600` so a crash never leaves a half-written credential document behind.
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Directory that keeps the Tenisle credentials: `$DSH_HOME/tenisle`.
 *
 * @param {NodeJS.ProcessEnv} [env] - environment to read `DSH_HOME` from.
 * @returns {string} absolute credential directory.
 */
export function defaultStateDir(env = process.env) {
  const home = env.DSH_HOME?.trim()
  return join(home && home.length > 0 ? home : join(homedir(), '.dsh'), 'tenisle')
}

/** File-backed store for the OAuth client registration and the token set. */
export class CredentialStore {
  #file
  #log
  #cache

  /**
   * @param {object} options
   * @param {string} options.file - absolute path of the credential document.
   * @param {{warn?: (message: string) => void}} [options.log] - optional logger.
   */
  constructor({ file, log }) {
    this.#file = file
    this.#log = log
  }

  /** @returns {string} absolute path of the credential document. */
  get file() {
    return this.#file
  }

  /**
   * Read the whole credential document; a missing or malformed file reads as `{}`.
   *
   * @returns {Promise<Record<string, unknown>>} the cached document.
   */
  async read() {
    if (this.#cache !== undefined) return this.#cache
    let text
    try {
      text = await readFile(this.#file, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') this.#log?.warn?.(`tenisle: cannot read ${this.#file}: ${error.message}`)
      this.#cache = {}
      return this.#cache
    }
    try {
      const parsed = JSON.parse(text)
      this.#cache = parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      this.#log?.warn?.(`tenisle: ignoring malformed ${this.#file}: ${error.message}`)
      this.#cache = {}
    }
    return this.#cache
  }

  /**
   * Merge a shallow patch into the document and persist it.
   *
   * @param {Record<string, unknown>} patch - top-level keys to replace.
   * @returns {Promise<Record<string, unknown>>} the stored document.
   */
  async patch(patch) {
    const current = await this.read()
    const next = { ...current, ...patch }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key]
    }
    await this.#write(next)
    return next
  }

  async #write(value) {
    await mkdir(dirname(this.#file), { recursive: true, mode: 0o700 })
    const temporary = `${this.#file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.#file)
    try {
      await chmod(this.#file, 0o600)
    } catch {
      /* best effort on platforms without POSIX modes */
    }
    this.#cache = value
  }
}
