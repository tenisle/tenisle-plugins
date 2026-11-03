#!/usr/bin/env node
/**
 * Generate the DeepSeek Harness plugin market index (format 1) for this bundle.
 *
 * DeepSeek Harness reads a plugin market as one static JSON document; the
 * Discover tab and the `plugin_market` tool fetch it and hand the install
 * arguments of the chosen version to the plugin manager. This bundle is not
 * published to npm, so every version here installs from a commit-pinned copy of
 * the `dsh/` directory in this repository.
 *
 * The document is generated rather than hand-written so the version, localized
 * display text, icon and commit stay in step with the package:
 *
 *   cd dsh
 *   npm run market -- --commit "$(git rev-parse HEAD)"
 *
 * Release flow: bump `version` in package.json, merge, tag the merge commit
 * (for example `dsh-v0.2.0`), then regenerate the index with that tag's commit
 * and commit the result.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKET_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = dirname(MARKET_DIR)
const PACKAGE_SUBDIRECTORY = 'dsh'
const DEFAULT_REPOSITORY = 'https://github.com/tenisle/tenisle-plugins'
const DEFAULT_CDN = 'https://cdn.jsdelivr.net/gh'
const DEFAULT_AUTHOR = 'Yasin Demir'
const INDEX_FILE = join(MARKET_DIR, 'index.json')

/**
 * Build the localized display text from the package's locale documents.
 *
 * @param {Record<string, {title?: string, description?: string}>} locales - meta of each locale.
 * @param {'title' | 'description'} field - field to project.
 * @returns {Record<string, string>} localized text; the market requires `en`.
 */
export function localized(locales, field) {
  const text = {}
  for (const [language, meta] of Object.entries(locales)) {
    const value = meta?.[field]
    if (typeof value === 'string' && value.length > 0) text[language] = value
  }
  return text
}

/**
 * Build one market index document.
 *
 * @param {object} options
 * @param {object} options.manifest - this package's `package.json`.
 * @param {Record<string, {title?: string, description?: string}>} options.locales - meta of each locale.
 * @param {string} options.commit - 40-hex commit that contains the installable `dsh/` directory.
 * @param {number} options.publishTimestamp - Unix seconds of that version.
 * @param {string} [options.repository] - repository web URL.
 * @param {string} [options.author] - display author.
 * @param {string} [options.cdn] - jsDelivr origin used for the pinned icon.
 * @returns {object} format-1 market index.
 */
export function buildIndex({
  manifest,
  locales,
  commit,
  publishTimestamp,
  repository = DEFAULT_REPOSITORY,
  author = DEFAULT_AUTHOR,
  cdn = DEFAULT_CDN,
}) {
  const owner = repository.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')
  return {
    format: 1,
    title: { en: 'Tenisle plugins', tr: 'Tenisle eklentileri' },
    description: {
      en: 'Official Tenisle plugins for DeepSeek Harness.',
      tr: 'DeepSeek Harness için resmî Tenisle eklentileri.',
    },
    plugins: [
      {
        name: manifest.name,
        title: localized(locales, 'title'),
        description: localized(locales, 'description'),
        icon: `${cdn}/${owner}@${commit}/${PACKAGE_SUBDIRECTORY}/icon.png`,
        author,
        homepage: manifest.homepage,
        repository: { url: repository, directory: PACKAGE_SUBDIRECTORY },
        versions: [
          {
            version: manifest.version,
            publishTimestamp,
            source: {
              type: 'git',
              url: `${repository}.git`,
              commit,
              path: PACKAGE_SUBDIRECTORY,
            },
          },
        ],
      },
    ],
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: PACKAGE_DIR, encoding: 'utf8' }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (!argument.startsWith('--')) throw new Error(`unexpected argument: ${argument}`)
    const key = argument.slice(2)
    if (key === 'dry') {
      options.dry = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for --${key}`)
    options[key] = value
    index += 1
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = readJson(join(PACKAGE_DIR, 'package.json'))
  const locales = {
    en: readJson(join(PACKAGE_DIR, 'locale', 'en.json')).meta,
    tr: readJson(join(PACKAGE_DIR, 'locale', 'tr.json')).meta,
  }
  const commit = options.commit ?? git(['rev-parse', 'HEAD'])
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`--commit must be a 40-character lowercase hex SHA (received "${commit}")`)
  const publishTimestamp = Number(options.timestamp ?? git(['show', '-s', '--format=%ct', commit]))
  if (!Number.isInteger(publishTimestamp) || publishTimestamp <= 0) {
    throw new Error(`cannot determine a Unix timestamp for ${commit}`)
  }
  const document = buildIndex({
    manifest,
    locales,
    commit,
    publishTimestamp,
    ...(options.repository ? { repository: options.repository } : {}),
    ...(options.author ? { author: options.author } : {}),
  })
  const body = `${JSON.stringify(document, null, 2)}\n`
  if (options.dry === true) {
    process.stdout.write(body)
    return
  }
  writeFileSync(INDEX_FILE, body)
  process.stdout.write(`wrote ${INDEX_FILE} (${manifest.name}@${manifest.version}, commit ${commit})\n`)
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
