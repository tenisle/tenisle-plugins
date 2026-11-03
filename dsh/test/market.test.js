/**
 * Offline checks for the DeepSeek Harness plugin market index.
 *
 * The published document is static JSON, so these tests guard the two things
 * that break silently: a document that no longer matches format 1, and a
 * generator that drifts from the committed index.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildIndex } from '../market/generate.mjs'

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const COMMIT = /^[0-9a-f]{40}$/

async function readJson(...parts) {
  return JSON.parse(await readFile(join(PACKAGE_DIR, ...parts), 'utf8'))
}

test('published market index satisfies format 1', async () => {
  const index = await readJson('market', 'index.json')
  assert.equal(index.format, 1)
  assert.equal(typeof index.title.en, 'string')
  assert.equal(index.plugins.length, 1)

  const plugin = index.plugins[0]
  assert.equal(plugin.name, '@tenisle/dsh-plugin')
  assert.match(plugin.icon, /^https:\/\//)
  assert.equal(plugin.repository.directory, 'dsh')

  for (const version of plugin.versions) {
    assert.match(version.version, SEMVER)
    assert.equal(Number.isInteger(version.publishTimestamp), true)
    assert.ok(version.publishTimestamp > 0)
    assert.equal(version.source.type, 'git')
    assert.equal(version.source.path, 'dsh')
    assert.match(version.source.commit, COMMIT)
    assert.match(version.source.url, /^https:\/\/github\.com\/tenisle\/tenisle-plugins\.git$/)
  }
})

test('the committed index matches this package version and locales', async () => {
  const index = await readJson('market', 'index.json')
  const manifest = await readJson('package.json')
  const plugin = index.plugins[0]
  assert.equal(plugin.name, manifest.name)
  assert.deepEqual(
    plugin.versions.map((version) => version.version),
    [manifest.version],
  )
  for (const language of ['en', 'tr']) {
    const meta = (await readJson('locale', `${language}.json`)).meta
    assert.equal(plugin.title[language], meta.title)
    assert.equal(plugin.description[language], meta.description)
  }
})

test('the generator pins the icon and source to the given commit', async () => {
  const manifest = await readJson('package.json')
  const locales = {
    en: (await readJson('locale', 'en.json')).meta,
    tr: (await readJson('locale', 'tr.json')).meta,
  }
  const commit = 'a'.repeat(40)
  const built = buildIndex({ manifest, locales, commit, publishTimestamp: 1793719875 })
  const plugin = built.plugins[0]

  assert.equal(built.format, 1)
  assert.equal(plugin.name, manifest.name)
  assert.equal(plugin.title.en, 'tenisle')
  assert.equal(plugin.title.tr, 'tenisle')
  assert.equal(
    plugin.icon,
    `https://cdn.jsdelivr.net/gh/tenisle/tenisle-plugins@${commit}/dsh/icon.png`,
  )
  assert.deepEqual(plugin.versions[0].source, {
    type: 'git',
    url: 'https://github.com/tenisle/tenisle-plugins.git',
    commit,
    path: 'dsh',
  })
  assert.equal(plugin.versions[0].version, manifest.version)
})
