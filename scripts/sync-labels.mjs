// Reconciles the repository's labels with .github/labels.json.
//
// Labels are shared state that nothing else in the tree records: they are
// edited in a web form, and a set that took thought to arrive at can be
// undone by one person clicking delete. Keeping them in a file makes the set
// reviewable in a diff and rebuildable after that.
//
// A dry run is the default on purpose. Everything this writes lands on GitHub
// immediately and some of it -- a rename, a prune -- changes what is attached
// to issues people have already filed, so the plan is printed and nothing
// happens until --apply says so.
//
// Usage:
//   node scripts/sync-labels.mjs                  print what differs
//   node scripts/sync-labels.mjs --apply          create, rename and update
//   node scripts/sync-labels.mjs --apply --prune  also delete labels not in the file
//
// Renames come from the `from` field. `bug` and `enhancement` carry issues
// already, so they are renamed in place; deleting and recreating them would
// silently strip every assignment.
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apply = process.argv.includes('--apply')
const prune = process.argv.includes('--prune')

function gh(...args) {
  return execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

const file = JSON.parse(await readFile(resolve(root, '.github/labels.json'), 'utf8'))
const wanted = Object.entries(file)
  .filter(([group]) => !group.startsWith('$'))
  .flatMap(([, labels]) => labels)

let current
try {
  current = JSON.parse(gh('label', 'list', '--limit', '200', '--json', 'name,color,description'))
} catch (error) {
  console.error('could not read the labels from GitHub. Is `gh` installed and authenticated?')
  console.error(String(error.stderr ?? error.message).trim())
  process.exit(1)
}

const byName = new Map(current.map((label) => [label.name, label]))
// GitHub stores the colour without the hash and lowercased; the file writes it
// the way a designer would. Compare them in one case so a match is a match.
const same = (a, b) =>
  a.color.toLowerCase() === b.color.toLowerCase() && (a.description ?? '') === (b.description ?? '')

const plan = []
for (const label of wanted) {
  const existing = byName.get(label.name)
  const source = label.from ? byName.get(label.from) : undefined

  if (!existing && source) plan.push({ action: 'rename', label, from: label.from })
  else if (!existing) plan.push({ action: 'create', label })
  else if (!same(existing, label)) plan.push({ action: 'update', label })
}

// A label the file does not name is reported whether or not --prune is set: an
// unexpected one is usually a rename that already happened by hand, and seeing
// it is the point. `from` names are not extras while their rename is pending.
const claimed = new Set(wanted.flatMap((label) => [label.name, label.from].filter(Boolean)))
const extra = current.filter((label) => !claimed.has(label.name))

if (plan.length === 0 && extra.length === 0) {
  console.log('labels: already in sync')
  process.exit(0)
}

const describe = (entry) =>
  entry.action === 'rename'
    ? `  rename  ${entry.from} -> ${entry.label.name}`
    : `  ${entry.action.padEnd(6)}  ${entry.label.name}`

for (const entry of plan) console.log(describe(entry))
for (const label of extra) {
  console.log(`  ${prune && apply ? 'delete' : 'extra '}  ${label.name}`)
}

if (!apply) {
  console.log(`\n${plan.length} change(s), ${extra.length} not in the file.`)
  console.log('Nothing was written. Re-run with --apply to write it.')
  if (extra.length > 0 && !prune) console.log('Add --prune to delete the ones the file does not name.')
  process.exit(0)
}

let failed = 0
const run = (what, ...args) => {
  try {
    gh(...args)
  } catch (error) {
    failed += 1
    console.error(`failed: ${what}`)
    console.error(String(error.stderr ?? error.message).trim())
  }
}

for (const { action, label, from } of plan) {
  const fields = ['--color', label.color, '--description', label.description ?? '']
  if (action === 'rename') run(`rename ${from}`, 'label', 'edit', from, '--name', label.name, ...fields)
  else if (action === 'create') run(`create ${label.name}`, 'label', 'create', label.name, ...fields)
  else run(`update ${label.name}`, 'label', 'edit', label.name, ...fields)
}

if (prune) {
  for (const label of extra) {
    run(`delete ${label.name}`, 'label', 'delete', label.name, '--yes')
  }
}

console.log(failed === 0 ? '\nlabels: applied' : `\nlabels: ${failed} operation(s) failed`)
process.exit(failed === 0 ? 0 : 1)
