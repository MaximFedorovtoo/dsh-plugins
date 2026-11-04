// Offline self-check for the dsh-llm-kimi client (sidebar) bundle.
//
// The bundle is a browser artifact, so this harness loads it in a VM with an
// inert React stub and a fake Cordis client context. It checks the parts that
// are not React rendering: dictionary parity, the slot-registration contract,
// and every Host-Remote operation the page calls (snapshot reads, key writes,
// invalidation wiring). Rendering is deliberately not emulated — the live page
// is the only authority for what the user sees.
//
// Run with: node test/selfcheck.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

const React = {
	createElement: () => null,
	useState: (initial) => [initial, () => {}],
	useEffect: () => {},
	useRef: (value) => ({ current: value }),
	useCallback: (fn) => fn,
}

let captured
const sandbox = {
	window: {
		__ModuleLoader__: {
			load(definition) {
				captured = definition
			},
		},
	},
	require(name) {
		if (name === 'react') return React
		throw new Error(`unexpected module request: ${name}`)
	},
	navigator: { clipboard: { writeText: async () => {} } },
	setTimeout,
	console,
}
vm.runInNewContext(source, sandbox, { filename: 'client.js' })

assert.ok(captured, 'the bundle registered itself')
assert.equal(captured.id, 'dsh-llm-kimi')
const plugin = captured.factory(sandbox.require)
assert.deepEqual([...plugin.inject], ['slots', 'locale', 'remote'])

// ---- fake Host Remotes -----------------------------------------------------

const calls = []
const asResult = (value) => ({ ok: true, value })
const asFailure = (message) => ({ ok: false, error: { code: 'test/failure', message } })

const state = {
	providers: [
		{ id: 'kimi-code', name: 'Kimi Code' },
		{ id: 'moonshot', name: 'Kimi API' },
		{ id: 'deepseek-account', name: 'DeepSeek' },
	],
	declared: [
		{
			provider: 'kimi-code',
			displayName: 'Kimi Code (подписка)',
			settingsNs: 'llm-kimi',
			settingsPath: ['providers', 'kimi-code'],
			defaultBaseURL: 'https://api.kimi.ai/coding',
			nativeAuth: { env: ['KIMI_CODE_API_KEY'] },
		},
		{
			provider: 'moonshot',
			displayName: 'Kimi API (оплата по токенам)',
			settingsNs: 'llm-kimi',
			settingsPath: ['providers', 'moonshot'],
			defaultBaseURL: 'https://api.moonshot.ai/anthropic',
			nativeAuth: { env: ['MOONSHOT_API_KEY'] },
		},
		{
			provider: 'deepseek-account',
			displayName: 'DeepSeek Account',
			settingsNs: 'llm-deepseek-account',
			settingsPath: [],
			defaultBaseURL: 'https://api.deepseek.com/anthropic',
			nativeAuth: { env: [] },
		},
	],
	credentials: { KIMI_CODE_API_KEY: { configured: true, writable: true } },
	catalog: {
		groups: [
			{
				id: 'kimi-code',
				name: 'Kimi Code',
				models: [
					{ id: 'k3.1-pro', name: 'Kimi K3.1 Pro' },
					{ id: 'k3', name: 'Kimi K3' },
				],
			},
			{ id: 'deepseek-account', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] },
		],
		failures: [],
	},
}
let describeFailure = null
let setFailure = null

const remote = {
	$on(name) {
		calls.push(['$on', name])
		return () => {}
	},
	llm: {
		async listProviders() {
			return asResult(state.providers)
		},
		async listConfigurableProviders() {
			return asResult(state.declared)
		},
	},
	credentials: {
		// The Host answers for every requested reference, configured or not.
		async describe(refs) {
			calls.push(['describe', [...refs]])
			if (describeFailure !== null) return asFailure(describeFailure)
			const described = {}
			for (const ref of refs) described[ref] = state.credentials[ref] ?? { configured: false, writable: true }
			return asResult(described)
		},
		async set(ref, value) {
			calls.push(['set', ref, value])
			if (setFailure !== null) return asFailure(setFailure)
			state.credentials[ref] = { configured: true, writable: true }
			return asResult(undefined)
		},
		async unset(ref) {
			calls.push(['unset', ref])
			delete state.credentials[ref]
			return asResult(undefined)
		},
	},
	session: {
		async modelCatalog() {
			return asResult(state.catalog)
		},
	},
}

// ---- fake client context ---------------------------------------------------

const localeDictionaries = []
const registrations = []
const effects = []
let selectedPanel
const ctx = {
	get(name) {
		if (name === 'remote') return remote
		if (name === 'remote.llm') return remote.llm
		if (name === 'remote.credentials') return remote.credentials
		if (name === 'remote.session') return remote.session
		if (name === 'layout') return { selectPanel: (id) => (selectedPanel = id) }
		return undefined
	},
	on() {
		return () => {}
	},
	effect(callback, label) {
		const dispose = callback()
		effects.push([label, dispose])
		return dispose
	},
	locale: {
		register(ns, localeOrDicts, dict) {
			if (typeof localeOrDicts === 'string') localeDictionaries.push([ns, localeOrDicts, dict])
			else for (const [locale, entries] of Object.entries(localeOrDicts)) localeDictionaries.push([ns, locale, entries])
			return () => {}
		},
		bind() {
			const dictionaries = new Map(localeDictionaries.map(([ns, locale, entries]) => [locale, entries]))
			const lookup = (key) => {
				for (const locale of ['ru', 'en']) {
					const value = dictionaries.get(locale)?.[key]
					if (typeof value === 'string') return value
				}
				return key
			}
			return (key, params) =>
				lookup(key).replace(/\{(\w+)\}/gu, (match, name) => (params && name in params ? String(params[name]) : match))
		},
	},
	slots: {
		inject(key, callback) {
			callback()
		},
		register(options, component) {
			registrations.push({ options, component })
		},
	},
}

plugin.apply(ctx)

// ---- dictionaries ----------------------------------------------------------

const en = localeDictionaries.find(([, locale]) => locale === 'en')?.[2]
const ru = localeDictionaries.find(([, locale]) => locale === 'ru')?.[2]
assert.ok(en, 'english dictionary registered')
assert.ok(ru, 'russian dictionary registered')
assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort(), 'russian keys match english keys')
for (const [key, value] of Object.entries(en)) assert.equal(typeof value, 'string', `english "${key}" is text`)

// ---- slot registrations ----------------------------------------------------

assert.equal(registrations.length, 2, 'two slot registrations')
const main = registrations.find(({ options }) => options.name === 'main')
const side = registrations.find(({ options }) => options.name === 'sidebar.panellist')
assert.ok(main && side, 'the page and the sidebar entry are registered')
assert.equal(main.options.key, 'kimi')
assert.equal(side.options.id, 'kimi')
assert.equal(side.options.order, 20)
assert.equal(side.options.label(), en.nav)
assert.equal(typeof main.options.inject, 'function')
const props = main.options.inject()
for (const name of ['loadSnapshot', 'setKey', 'unsetKey', 'subscribe', 'copyText', 'openPlugins', 't']) {
	assert.equal(typeof props[name], 'function', `${name} is injected`)
}

// ---- snapshot --------------------------------------------------------------

const snapshot = await props.loadSnapshot()
assert.equal(snapshot.anyActive, true)
assert.deepEqual(
	Array.from(snapshot.routes, (route) => route.id),
	['kimi-code', 'moonshot'],
	'only the Kimi routes are listed',
)
const [kimiCode, moonshot] = snapshot.routes
assert.equal(kimiCode.baseURL, 'https://api.kimi.ai/coding')
assert.deepEqual(Array.from(kimiCode.refs), ['KIMI_CODE_API_KEY'])
assert.equal(kimiCode.configured, true, 'a stored key is reported configured')
assert.equal(kimiCode.active, true)
assert.equal(moonshot.configured, false, 'an unset key is reported missing')
assert.deepEqual(
	Array.from(snapshot.modelGroups, (group) => group.id),
	['kimi-code'],
	'only Kimi model groups are listed',
)
assert.deepEqual(
	Array.from(snapshot.modelGroups[0].models, (model) => model.id),
	['k3.1-pro', 'k3'],
)
assert.equal(props.t('route.kimi-code.name'), 'Kimi Code — подписка')
assert.equal(props.t('saveError', { message: 'nope' }), 'Не удалось сохранить ключ: nope')

// ---- credential writes -----------------------------------------------------

const saved = await props.setKey(kimiCode, 'sk-test-123')
assert.equal(saved.ok, true)
assert.deepEqual(calls.find((call) => call[0] === 'set'), ['set', 'KIMI_CODE_API_KEY', 'sk-test-123'])

setFailure = 'host refused'
const rejected = await props.setKey(moonshot, 'sk-test-456')
assert.equal(rejected.ok, false)
assert.equal(rejected.message, 'host refused')
setFailure = null

const removed = await props.unsetKey(kimiCode)
assert.equal(removed.ok, true)
assert.deepEqual(calls.find((call) => call[0] === 'unset'), ['unset', 'KIMI_CODE_API_KEY'])

// ---- degradation paths -----------------------------------------------------

describeFailure = 'credential store offline'
const degraded = await props.loadSnapshot()
assert.equal(degraded.credentialError, 'credential store offline')
assert.equal(degraded.routes[0].configured, null, 'unknown credential state stays unknown')
describeFailure = null

state.providers = []
state.declared = []
state.catalog.groups = []
const missingProvider = await props.loadSnapshot()
assert.equal(missingProvider.anyActive, false)
assert.deepEqual(
	Array.from(missingProvider.routes, (route) => route.id),
	['kimi-code', 'moonshot'],
	'fallback routes keep the key fields usable',
)
assert.deepEqual(Array.from(missingProvider.routes[0].refs), ['KIMI_CODE_API_KEY'])
assert.equal(missingProvider.modelGroups.length, 0)

// ---- invalidation & helpers ------------------------------------------------

assert.ok(calls.some((call) => call[0] === '$on' && call[1] === 'credentials/reference-updated'))
assert.ok(calls.some((call) => call[0] === '$on' && call[1] === 'llm/adapters-updated'))
const invalidation = effects.find(([label]) => label === 'kimi-connect: remote invalidations')
assert.ok(invalidation, 'remote invalidation effect registered')

let notified = 0
const unsubscribe = props.subscribe(() => {
	notified += 1
})
unsubscribe()

assert.equal(await props.copyText('https://example.test'), true)
assert.equal(props.openPlugins(), true)
assert.equal(selectedPanel, 'plugins')

for (const [, dispose] of effects) if (typeof dispose === 'function') dispose()

console.log('self-check: ok')
