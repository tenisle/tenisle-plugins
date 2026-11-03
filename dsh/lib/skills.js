/**
 * Embedded skills for the Tenisle plugin.
 *
 * The two skills ship as `SKILL.md` files inside this package and are
 * registered on the harness skill registry at load time, so they reach every
 * agent catalog without copying files into a user skill directory.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Skill documents bundled with the plugin, relative to the package root. */
const SKILL_DOCUMENTS = ['skills/tenisle-player-stats/SKILL.md', 'skills/tenisle-score-entry/SKILL.md']

/**
 * Split a `SKILL.md` document into its frontmatter attributes and body.
 *
 * Only the flat `key: value` form is read, which is all the bundled skills use;
 * quoted values are unquoted. A missing `name` or `description` rejects the
 * document so a malformed skill never registers a half-empty catalog entry.
 *
 * @param {string} text - the raw skill document.
 * @returns {{attributes: Record<string, string>, body: string}} parsed document.
 */
function parseSkillDocument(text) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (frontmatter === null) throw new Error('missing YAML frontmatter')
  const attributes = {}
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    let value = match[2].trim()
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    if (value.length > 0) attributes[match[1]] = value
  }
  if (typeof attributes.name !== 'string' || typeof attributes.description !== 'string') {
    throw new Error('frontmatter needs name and description')
  }
  return { attributes, body: text.slice(frontmatter[0].length).trim() }
}

/**
 * Register every bundled skill on the harness skill registry.
 *
 * @param {{skills: {register: (skill: object) => () => void}}} ctx - context carrying the skill registry.
 * @param {string} packageDir - absolute directory of this plugin package.
 * @param {{warn?: Function}} [log] - optional logger.
 * @returns {() => void} disposer that unregisters every registered skill.
 */
export function registerSkills(ctx, packageDir, log) {
  const disposers = []
  for (const relative of SKILL_DOCUMENTS) {
    const path = join(packageDir, relative)
    let parsed
    try {
      parsed = parseSkillDocument(readFileSync(path, 'utf8'))
    } catch (error) {
      log?.warn?.(`tenisle: skill ${relative} skipped: ${error.message}`)
      continue
    }
    const { attributes, body } = parsed
    try {
      disposers.push(
        ctx.skills.register({
          name: attributes.name,
          description: attributes.description,
          ...(attributes.whenToUse ? { whenToUse: attributes.whenToUse } : {}),
          content: body,
          path,
          source: 'bundled',
          resourceBase: { kind: 'directory', path: dirname(path) },
        }),
      )
    } catch (error) {
      log?.warn?.(`tenisle: skill ${attributes.name} could not be registered: ${error.message}`)
    }
  }
  return () => {
    for (const dispose of disposers) dispose()
  }
}
