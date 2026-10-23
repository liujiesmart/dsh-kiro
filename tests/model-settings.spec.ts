import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { KiroCatalogModel } from '../src/adapter.ts'
import {
  compareKiroModels,
  FileModelSettingsStore,
  modelSelection,
} from '../src/model-settings.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function store(): Promise<{ store: FileModelSettingsStore; file: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-kiro-models-'))
  temporaryDirectories.push(directory)
  const file = join(directory, 'model-settings.json')
  return { store: new FileModelSettingsStore(file), file }
}

const catalog = (...ids: string[]): KiroCatalogModel[] => ids.map(id => ({ id, name: id, thinking: true }))

describe('Kiro model settings', () => {
  it('treats the whole catalog as selected before settings are persisted', async () => {
    const fixture = await store()
    const models = catalog('claude-sonnet-4.6', 'claude-opus-5', 'gpt-5.6-luna')
    await expect(fixture.store.enabledModels(models)).resolves.toEqual([
      models[1], models[0], models[2],
    ])
    await expect(modelSelection(fixture.store, models)).resolves.toMatchObject({
      enabledModelIds: ['claude-opus-5', 'claude-sonnet-4.6', 'gpt-5.6-luna'],
      models: [{ enabled: true }, { enabled: true }, { enabled: true }],
    })
  })

  it('retains checkbox choices, enables new discoveries, and removes stale ids', async () => {
    const fixture = await store()
    await fixture.store.mergeCatalog(catalog('claude-opus-4.8', 'gpt-5.6-sol'))
    await fixture.store.setEnabledModelIds(['claude-opus-4.8'], catalog('claude-opus-4.8', 'gpt-5.6-sol'))
    const settings = await fixture.store.mergeCatalog(catalog('claude-opus-5', 'gpt-5.6-sol'))
    expect(settings).toMatchObject({
      enabledModelIds: ['claude-opus-5'],
      knownModelIds: ['claude-opus-5', 'gpt-5.6-sol'],
    })
    expect(JSON.parse(await readFile(fixture.file, 'utf8'))).toMatchObject({
      enabledModelIds: ['claude-opus-5'],
    })
  })

  it('keeps a route visible when every previously enabled id disappears', async () => {
    // A partial catalog, another account, or a region switch can drop the whole
    // enabled selection. Persisting an empty selection would hide the provider
    // from every picker — including the page that could re-enable it — so the
    // merge falls back to the full catalog it just observed.
    const fixture = await store()
    await fixture.store.mergeCatalog(catalog('claude-opus-4.8', 'gpt-5.6-sol'))
    await fixture.store.setEnabledModelIds(['claude-opus-4.8'], catalog('claude-opus-4.8', 'gpt-5.6-sol'))
    // Every id the shorter catalog still reports was already known, so nothing
    // is "newly discovered" and nothing the user enabled survived: without the
    // fallback this merge would persist an empty selection.
    const settings = await fixture.store.mergeCatalog(catalog('gpt-5.6-sol'))
    expect(settings).toMatchObject({ enabledModelIds: ['gpt-5.6-sol'] })
    await expect(fixture.store.enabledModels(catalog('gpt-5.6-sol')))
      .resolves.toHaveLength(1)
  })

  it('honours a stored selection of nothing instead of healing it away', async () => {
    // `knownModelIds` is the "has this installation ever been configured"
    // signal. Once it is populated, an empty selection is a choice the user
    // made, not a damaged file, and re-enabling everything would overrule it.
    const fixture = await store()
    await writeFile(fixture.file, JSON.stringify({
      enabledModelIds: [],
      knownModelIds: ['claude-opus-5', 'gpt-5.6-sol'],
      updatedAt: 1,
    }))
    const models = catalog('claude-opus-5', 'gpt-5.6-sol')
    await expect(fixture.store.enabledModels(models)).resolves.toEqual([])
    await expect(modelSelection(fixture.store, models)).resolves.toMatchObject({
      enabledModelIds: [],
      models: [{ enabled: false }, { enabled: false }],
    })
  })

  it('treats a file with no recorded catalog as never configured', async () => {
    const fixture = await store()
    await writeFile(fixture.file, JSON.stringify({ enabledModelIds: [], knownModelIds: [], updatedAt: 0 }))
    const models = catalog('claude-opus-5', 'gpt-5.6-sol')
    await expect(fixture.store.enabledModels(models)).resolves.toHaveLength(2)
  })

  it('deselects everything on an explicit empty selection and selects it back', async () => {
    // The Deselect all button sends `[]`. Reading that as "reset to default"
    // made the button do nothing, which is the bug this pins.
    const fixture = await store()
    const models = catalog('claude-opus-5', 'gpt-5.6-sol')
    await fixture.store.mergeCatalog(models)
    const settings = await fixture.store.setEnabledModelIds([], models)
    expect(settings.enabledModelIds).toEqual([])
    await expect(fixture.store.enabledModels(models)).resolves.toEqual([])

    // A later discovery must not undo the choice either.
    const discovered = catalog('claude-opus-5', 'gpt-5.6-sol', 'claude-opus-6')
    await fixture.store.mergeCatalog(discovered)
    await expect(fixture.store.enabledModels(discovered)).resolves.toEqual([])

    // The settings card still lists every model, which is what makes it undoable.
    const selection = await modelSelection(fixture.store, discovered)
    expect(selection.enabledModelIds).toEqual([])
    expect(selection.models.every(model => !model.enabled)).toBe(true)

    // Select all restores the route.
    await fixture.store.setEnabledModelIds(discovered.map(model => model.id), discovered)
    await expect(fixture.store.enabledModels(discovered)).resolves.toHaveLength(3)
  })

  it('leaves the stored selection alone when discovery observed no models', async () => {
    const fixture = await store()
    await fixture.store.mergeCatalog(catalog('claude-opus-4.8', 'gpt-5.6-sol'))
    await fixture.store.setEnabledModelIds(['claude-opus-4.8'], catalog('claude-opus-4.8', 'gpt-5.6-sol'))
    const settings = await fixture.store.mergeCatalog([])
    expect(settings).toMatchObject({
      enabledModelIds: ['claude-opus-4.8'],
      knownModelIds: ['claude-opus-4.8', 'gpt-5.6-sol'],
    })
  })

  it('sorts newest models first within stable provider families', () => {
    const models = catalog(
      'auto',
      'gpt-5.6-luna',
      'claude-sonnet-4.6',
      'claude-opus-4.8',
      'claude-sonnet-5',
      'claude-opus-5',
    ).sort(compareKiroModels)
    expect(models.map(model => model.id)).toEqual([
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-opus-4.8',
      'claude-sonnet-4.6',
      'gpt-5.6-luna',
      'auto',
    ])
  })
})
