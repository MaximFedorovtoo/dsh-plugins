/**
 * `dsh-llm-kimi` — the Kimi sidebar panel of the DeepSeek Harness Web client.
 *
 * The package's Host half registers the two provider routes; this browser half
 * adds one global panel: a `Kimi` icon in the left sidebar
 * (`sidebar.panellist`) whose id addresses the page registered in the layout's
 * `main` keyed slot. The page writes and inspects exactly the credential
 * references the provider routes read, through Host Remotes the Web shell
 * already mounts:
 *
 * - `remote.llm.listConfigurableProviders()` — the live Kimi routes, their
 *   endpoints and their credential references;
 * - `remote.llm.listProviders()` / `remote.session.modelCatalog()` — whether
 *   those routes are registered and which models they advertise;
 * - `remote.credentials.describe/set/unset` — the write-only key store.
 *
 * The half is a browser artifact only: the Host half of the package keeps the
 * provider routes and the Loader row, and disabling the package removes both
 * the routes and the panel without touching stored keys.
 *
 * The browser artifact is a lazy factory registered into
 * `window.__ModuleLoader__`, the same form the shipped Web plugins use, so it
 * needs no build step and no Harness Client package at runtime.
 */
window.__ModuleLoader__.load({
	id: 'dsh-llm-kimi',
	factory(require) {
		const React = require('react')
		const h = React.createElement

		/** Client locale namespace owned by this plugin. */
		const NS = 'kimiConnect'
		/** One id addresses both the sidebar entry and the main-column page. */
		const PANEL_ID = 'kimi'

		/**
		 * Facts about the two routes the Kimi provider serves. The page prefers
		 * the live declaration reported by the Host and falls back to these when
		 * the provider bundle is not mounted, so the page still explains what to
		 * install and where the key belongs.
		 */
		const PRESET_ROUTES = [
			{
				id: 'kimi-code',
				mode: 'subscription',
				ref: 'KIMI_CODE_API_KEY',
				consoleUrl: 'https://www.kimi.ai/code/console',
				recommended: true,
			},
			{
				id: 'moonshot',
				mode: 'payg',
				ref: 'MOONSHOT_API_KEY',
				consoleUrl: 'https://platform.kimi.ai/console/api-keys',
			},
		]
		const PRESETS = new Map(PRESET_ROUTES.map((route) => [route.id, route]))
		/** Settings namespace `dsh-llm-kimi` mounts its routes under. */
		const PROVIDER_SETTINGS_NS = 'llm-kimi'
		/** Kimi account page: subscription, balance and account-level settings. */
		const ACCOUNT_URL = 'https://www.kimi.ai/settings/account'
		/** Kimi Code product page: plan, CLI/Desktop downloads and the Console entry. */
		const CODE_URL = 'https://www.kimi.ai/code'
		/** Same key-shape rules the Models settings page applies before writing. */
		const LEGAL_API_KEY = /^[\x21-\x7E]+$/u
		const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/u

		const en = {
			nav: 'Kimi',
			title: 'Connect Kimi',
			intro:
				'With a Kimi Code subscription, save the key from the Kimi Code console in the subscription card: requests draw from the membership quota. The Kimi API card is separate pay-per-token billing and is not needed for a subscription.',
			routesTitle: 'Kimi routes',
			'mode.subscription': 'subscription',
			'mode.payg': 'pay per token',
			'route.kimi-code.name': 'Kimi Code (subscription)',
			'route.kimi-code.desc':
				'Recommended when you pay for Kimi Code: requests draw from the membership quota, not from separate API credits. Create the key in the Kimi Code console under Create API Key.',
			'route.moonshot.name': 'Kimi API (pay per token)',
			'route.moonshot.desc':
				'Requests are billed per token on the Kimi API platform. Create the key in the platform console under API Keys.',
			endpoint: 'Endpoint',
			keyLabel: 'API key',
			refLabel: 'Credential reference',
			keyPlaceholder: 'Paste the API key',
			show: 'Show',
			hide: 'Hide',
			save: 'Save key',
			saving: 'Saving…',
			remove: 'Delete key',
			removing: 'Deleting…',
			confirmRemove: 'Delete the stored key?',
			confirmYes: 'Delete',
			confirmNo: 'Cancel',
			getKey: 'Open console',
			openPlugins: 'Open Plugins',
			account: 'Kimi account',
			codePage: 'Kimi Code',
			recommended: 'Recommended',
			configured: 'Key saved',
			missing: 'No key yet',
			unknown: 'Unknown',
			readOnly: 'Read-only',
			saved: 'Key saved. Pick a Kimi model in the model selector to start.',
			removed: 'Key deleted.',
			refresh: 'Refresh',
			refreshing: 'Refreshing…',
			loading: 'Reading the connection state…',
			retry: 'Retry',
			providerMissingTitle: 'Kimi provider is not registered',
			providerMissingBody:
				'The dsh-llm-kimi provider plugin is not active in this profile, so a key has nowhere to go. Install or enable it on the Plugins page.',
			modelsTitle: 'Available Kimi models',
			modelsEmpty: 'The provider is registered but does not advertise models yet.',
			modelsFailure: 'The provider could not list models: {message}',
			nextTitle: 'What happens next',
			nextBody:
				'After the key is saved, open the model selector under the composer and choose a Kimi Code model, for example Kimi K3.1 Pro or Kimi for Coding. The reasoning level is switched there as well.',
			storeHint:
				'The key is stored write-only in the harness credential store: the interface never reads it back. A key saved here wins over the KIMI_CODE_API_KEY and MOONSHOT_API_KEY environment variables.',
			loadError: 'Could not read the connection state: {message}',
			saveError: 'Could not save the key: {message}',
			removeError: 'Could not delete the key: {message}',
			credentialUnavailable:
				'The credential service is unavailable, so this deployment cannot store keys.',
			keyBlank: 'Paste a key first.',
			keyIllegal: 'That value does not look like an API key. Paste only the key itself.',
			copy: 'Copy link',
			copied: 'Copied',
			copyFailed: 'Copy failed',
			inactiveRoute: 'Route inactive',
		}

		const ru = {
			nav: 'Kimi',
			title: 'Подключение Kimi',
			intro:
				'Если у вас подписка Kimi Code, сохраните ключ из её консоли в карточке «Kimi Code — подписка»: запросы будут списываться из квоты подписки. Карточка Kimi API — отдельная оплата по токенам, для подписки она не нужна.',
			routesTitle: 'Маршруты Kimi',
			'mode.subscription': 'подписка',
			'mode.payg': 'по токенам',
			'route.kimi-code.name': 'Kimi Code — подписка',
			'route.kimi-code.desc':
				'Рекомендуется при оплаченной подписке: запросы списываются из квоты Kimi Code, а не из отдельных кредитов API. Ключ создаётся в консоли Kimi Code: Create API Key.',
			'route.moonshot.name': 'Kimi API — оплата по токенам',
			'route.moonshot.desc':
				'Запросы оплачиваются по токенам на платформе Kimi API. Ключ создаётся в консоли платформы: API Keys.',
			endpoint: 'Эндпоинт',
			keyLabel: 'API-ключ',
			refLabel: 'Ссылка на учётные данные',
			keyPlaceholder: 'Вставьте API-ключ',
			show: 'Показать',
			hide: 'Скрыть',
			save: 'Сохранить ключ',
			saving: 'Сохранение…',
			remove: 'Удалить ключ',
			removing: 'Удаление…',
			confirmRemove: 'Удалить сохранённый ключ?',
			confirmYes: 'Удалить',
			confirmNo: 'Отмена',
			getKey: 'Открыть консоль',
			openPlugins: 'Открыть Plugins',
			account: 'Аккаунт Kimi',
			codePage: 'Kimi Code',
			recommended: 'Рекомендуется',
			configured: 'Ключ сохранён',
			missing: 'Ключа нет',
			unknown: 'Неизвестно',
			readOnly: 'Только чтение',
			saved: 'Ключ сохранён. Выберите модель Kimi в селекторе модели под полем ввода.',
			removed: 'Ключ удалён.',
			refresh: 'Обновить',
			refreshing: 'Обновление…',
			loading: 'Читаю состояние подключения…',
			retry: 'Повторить',
			providerMissingTitle: 'Провайдер Kimi не зарегистрирован',
			providerMissingBody:
				'Плагин-провайдер dsh-llm-kimi не активен в этом профиле, поэтому ключу некуда попасть. Установите или включите его на странице Plugins.',
			modelsTitle: 'Доступные модели Kimi',
			modelsEmpty: 'Провайдер зарегистрирован, но пока не отдаёт список моделей.',
			modelsFailure: 'Провайдер не смог перечислить модели: {message}',
			nextTitle: 'Что дальше',
			nextBody:
				'После сохранения ключа откройте селектор модели под полем ввода и выберите модель Kimi Code, например Kimi K3.1 Pro или Kimi for Coding. Рядом переключается и уровень рассуждений.',
			storeHint:
				'Ключ хранится write-only в хранилище учётных данных харнесса: интерфейс не читает его обратно. Ключ, сохранённый здесь, важнее переменных окружения KIMI_CODE_API_KEY и MOONSHOT_API_KEY.',
			loadError: 'Не удалось прочитать состояние подключения: {message}',
			saveError: 'Не удалось сохранить ключ: {message}',
			removeError: 'Не удалось удалить ключ: {message}',
			credentialUnavailable:
				'Сервис учётных данных недоступен, поэтому в этой сборке ключ сохранить нельзя.',
			keyBlank: 'Сначала вставьте ключ.',
			keyIllegal: 'Это не похоже на API-ключ. Вставьте только само значение ключа.',
			copy: 'Копировать ссылку',
			copied: 'Скопировано',
			copyFailed: 'Не удалось скопировать',
			inactiveRoute: 'Маршрут неактивен',
		}

		/**
		 * Styles for the page. Every color, radius and font reference is a host
		 * theme token with a plain fallback, so the panel follows the light/dark
		 * theme instead of pinning its own palette.
		 */
		const CSS = `
			.kc-root{box-sizing:border-box;width:100%;height:100%;min-height:0;overflow-y:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
			.kc-root *{box-sizing:border-box}
			.kc-inner{max-width:720px;margin:0 auto;padding:32px 24px 64px;display:flex;flex-direction:column;gap:16px}
			.kc-head{display:flex;align-items:flex-start;gap:12px}
			.kc-mark{flex:none;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
			.kc-headText{min-width:0;flex:1 1 auto}
			.kc-title{margin:0;font-size:18px;line-height:26px;font-weight:600;color:var(--dsw-alias-label-primary)}
			.kc-intro{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
			.kc-toolbar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
			.kc-banner{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;border-radius:12px;border:.5px solid var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
			.kc-bannerError{border-color:var(--dsw-alias-state-error-primary)}
			.kc-bannerText{flex:1 1 auto;min-width:0}
			.kc-bannerTitle{display:block;font-weight:500;color:var(--dsw-alias-label-primary)}
			.kc-bannerBody{display:block;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
			.kc-sectionTitle{margin:8px 0 0;font-size:14px;line-height:22px;font-weight:600}
			.kc-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1));background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1));border-radius:16px}
			.kc-cardHead{display:flex;align-items:center;justify-content:space-between;gap:12px}
			.kc-routeId{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
			.kc-routeName{font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}
			.kc-badge{flex:none;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;padding:1px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
			.kc-badgeWarn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
			.kc-badgeAccent{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
			.kc-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-border-l2)}
			.kc-dotOk{background:var(--dsw-alias-state-success-primary)}
			.kc-dotMissing{background:var(--dsw-alias-state-error-primary)}
			.kc-cardActions{display:flex;align-items:center;gap:8px;flex:none}
			.kc-desc{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
			.kc-meta{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
			.kc-code{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:1px 5px;word-break:break-all}
			.kc-form{display:flex;flex-direction:column;gap:6px}
			.kc-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
			.kc-keyRow{display:flex;gap:8px;align-items:center}
			.kc-keyField{position:relative;flex:1 1 auto;min-width:0}
			.kc-input{width:100%;height:36px;padding:0 64px 0 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;outline:none}
			.kc-input::placeholder{color:var(--dsw-alias-label-secondary)}
			.kc-input:focus{border-color:var(--dsw-alias-brand-primary)}
			.kc-input:disabled{opacity:.6}
			.kc-eye{position:absolute;top:2px;right:2px;height:32px;min-width:52px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
			.kc-eye:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
			.kc-eye:disabled{opacity:.5;cursor:default}
			.kc-primary{flex:none;height:36px;padding:0 14px;border:none;border-radius:8px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);font:inherit;font-size:14px;cursor:pointer;white-space:nowrap}
			.kc-primary:hover:not(:disabled){opacity:.92}
			.kc-primary:disabled{opacity:.45;cursor:default}
			.kc-secondary{flex:none;height:32px;padding:0 12px;display:inline-flex;align-items:center;gap:4px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;text-decoration:none;white-space:nowrap}
			.kc-secondary:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
			.kc-secondary:disabled{opacity:.5;cursor:default}
			.kc-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:20px;flex-wrap:wrap}
			.kc-state{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
			.kc-link{border:none;background:none;padding:0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:13px;line-height:18px;cursor:pointer;white-space:nowrap}
			.kc-link:hover:not(:disabled){text-decoration:underline}
			.kc-link:disabled{opacity:.5;cursor:default}
			.kc-danger{color:var(--dsw-alias-state-error-primary)}
			.kc-confirm{display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
			.kc-notice{margin:0;font-size:12px;line-height:18px}
			.kc-noticeOk{color:var(--dsw-alias-state-success-primary)}
			.kc-noticeErr{color:var(--dsw-alias-state-error-primary)}
			.kc-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
			.kc-models{display:flex;flex-direction:column;gap:10px}
			.kc-modelGroup{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
			.kc-modelGroupName{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);margin-right:2px}
			.kc-chip{border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;padding:1px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
			.kc-next{display:flex;flex-direction:column;gap:6px;padding:16px;border:.5px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1)}
			.kc-nextTitle{margin:0;font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}
			.kc-root :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
			@media (max-width:560px){
				.kc-inner{padding:20px 14px 48px}
				.kc-keyRow{flex-wrap:wrap}
				.kc-keyField{flex-basis:100%}
				.kc-primary{width:100%}
			}
		`

		/** The Kimi mark: a crescent with a small star, drawn in currentColor. */
		function KimiMark({ size = 20 }) {
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 20 20',
					fill: 'none',
					'aria-hidden': true,
					focusable: 'false',
					style: { display: 'block' },
				},
				h('path', {
					d: 'M12.95 2.2a7.6 7.6 0 1 0 4.55 13.42 8.7 8.7 0 0 1-4.55-13.42Z',
					fill: 'currentColor',
				}),
				h('circle', { cx: 15.4, cy: 4.4, r: 1.35, fill: 'currentColor', opacity: '0.7' }),
			)
		}

		/** Sidebar panel icon; the shell supplies the square edge and selected state. */
		function SidebarIcon({ size, active }) {
			return h(
				'span',
				{
					style: {
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: size,
						height: size,
						opacity: active ? 1 : 0.82,
					},
				},
				h(KimiMark, { size: Math.max(14, Math.round(size * 0.92)) }),
			)
		}

		/** Error with a stable code the page can translate. */
		function panelError(code, message) {
			const error = new Error(message ?? code)
			error.code = code
			return error
		}

		function messageOf(error) {
			if (error instanceof Error && error.message) return error.message
			return String(error)
		}

		/** Run a Remote call, folding a thrown rejection into `undefined`. */
		async function attempt(call) {
			try {
				return await call()
			} catch {
				return undefined
			}
		}

		function routeEntryOf(entry) {
			if (entry === null || typeof entry !== 'object') return false
			return PRESETS.has(entry.provider) || entry.settingsNs === PROVIDER_SETTINGS_NS
		}

		function refsOf(entry) {
			const preset = PRESETS.get(entry.provider)
			const declared = Array.isArray(entry.nativeAuth?.env)
				? entry.nativeAuth.env.filter((ref) => typeof ref === 'string' && ref.length > 0)
				: []
			if (declared.length > 0) return declared
			return preset === undefined ? [] : [preset.ref]
		}

		/**
		 * Bind the page to the Host Remotes. Everything returned here is plain
		 * data plus callbacks: the React tree never touches a Cordis context.
		 * @param ctx - the plugin's client context.
		 * @returns invalidation reach, snapshot reads, and the two key writes.
		 */
		function createOperations(ctx) {
			const listen = (name, handler) => {
				try {
					const dispose = ctx.get('remote')?.$on?.(name, handler)
					return typeof dispose === 'function' ? dispose : undefined
				} catch {
					return undefined
				}
			}
			const listeners = new Set()
			const notify = () => {
				for (const listener of [...listeners]) {
					try {
						listener()
					} catch {
						// A broken consumer must not break the next one.
					}
				}
			}

			ctx.effect(() => {
				const disposers = [
					listen('credentials/reference-updated', notify),
					listen('credentials/record-updated', notify),
					listen('llm/adapters-updated', notify),
				]
				try {
					const dispose = ctx.on?.('connection/reset', notify)
					if (typeof dispose === 'function') disposers.push(dispose)
				} catch {
					// Optional event: a client without it still refreshes manually.
				}
				return () => {
					for (const dispose of disposers) {
						try {
							dispose?.()
						} catch {
							// Teardown continues regardless.
						}
					}
				}
			}, 'kimi-connect: remote invalidations')

			const remoteOf = (name) => {
				try {
					const service = ctx.get('remote.' + name)
					if (service !== undefined && service !== null) return service
				} catch {
					// Fall through to the namespace object.
				}
				try {
					return ctx.remote?.[name]
				} catch {
					return undefined
				}
			}

			return {
				subscribe(listener) {
					if (typeof listener !== 'function') return () => {}
					listeners.add(listener)
					return () => {
						listeners.delete(listener)
					}
				},

				async loadSnapshot() {
					const llm = remoteOf('llm')
					const credentials = remoteOf('credentials')
					const session = remoteOf('session')

					let providers = []
					let declared = []
					if (llm !== undefined) {
						const registered = await attempt(() => llm.listProviders())
						if (registered?.ok === true && Array.isArray(registered.value)) providers = registered.value
						const directory = await attempt(() => llm.listConfigurableProviders())
						if (directory?.ok === true && Array.isArray(directory.value)) declared = directory.value
					}

					const providerIds = new Set(
						providers
							.map((provider) => provider?.id)
							.filter((id) => typeof id === 'string'),
					)
					const entries = declared.filter(routeEntryOf)
					const routes = (entries.length > 0 ? entries : []).map((entry) => {
						const preset = PRESETS.get(entry.provider)
						return {
							id: entry.provider,
							mode: preset?.mode ?? null,
							baseURL: typeof entry.defaultBaseURL === 'string' ? entry.defaultBaseURL : null,
							consoleUrl: preset?.consoleUrl ?? null,
							displayName: typeof entry.displayName === 'string' ? entry.displayName : null,
							refs: refsOf(entry),
							recommended: preset?.recommended === true,
							active: providerIds.has(entry.provider),
						}
					})
					if (routes.length === 0) {
						for (const preset of PRESET_ROUTES) {
							routes.push({
								id: preset.id,
								mode: preset.mode,
								baseURL: null,
								consoleUrl: preset.consoleUrl,
								displayName: null,
								refs: [preset.ref],
								recommended: preset.recommended === true,
								active: providerIds.has(preset.id),
							})
						}
					}

					const refs = [...new Set(routes.flatMap((route) => route.refs))]
					let described = {}
					let credentialError = null
					if (credentials === undefined) {
						credentialError = 'credentials-unavailable'
					} else if (refs.length > 0) {
						const answer = await attempt(() => credentials.describe(refs))
						if (answer?.ok === true && answer.value !== null && typeof answer.value === 'object') described = answer.value
						else credentialError = answer?.error?.message ?? 'credential describe failed'
					}
					for (const route of routes) {
						const known = route.refs.map((ref) => described[ref]).filter((info) => info !== null && typeof info === 'object')
						route.configured = known.length === 0 ? null : known.some((info) => info.configured === true)
						route.writable = known.length === 0 ? true : known.some((info) => info.writable !== false)
					}

					let modelGroups = []
					let catalogFailures = []
					if (session !== undefined) {
						const catalog = await attempt(() => session.modelCatalog())
						if (catalog?.ok === true && catalog.value !== null && typeof catalog.value === 'object') {
							const groups = Array.isArray(catalog.value.groups) ? catalog.value.groups : []
							const routeIds = new Set(routes.map((route) => route.id))
							modelGroups = groups
								.filter((group) => routeIds.has(group?.id))
								.map((group) => ({
									id: group.id,
									name: typeof group.name === 'string' ? group.name : group.id,
									models: (Array.isArray(group.models) ? group.models : [])
										.filter((model) => typeof model?.id === 'string')
										.map((model) => ({ id: model.id, name: typeof model.name === 'string' ? model.name : model.id })),
								}))
							const failures = Array.isArray(catalog.value.failures) ? catalog.value.failures : []
							catalogFailures = failures
								.filter((failure) => routeIds.has(failure?.id))
								.map((failure) => ({ id: failure.id, message: String(failure.message ?? '') }))
						}
					}

					return {
						routes,
						anyActive: routes.some((route) => route.active),
						providerCount: providers.length,
						modelGroups,
						catalogFailures,
						credentialError,
					}
				},

				async setKey(route, value) {
					const credentials = remoteOf('credentials')
					if (credentials === undefined) return { ok: false, code: 'credentials-unavailable' }
					const ref = route.refs[0]
					if (ref === undefined) return { ok: false, message: 'this route names no credential reference' }
					const answer = await attempt(() => credentials.set(ref, value))
					if (answer?.ok === true) return { ok: true }
					return { ok: false, message: answer?.error?.message ?? 'the Host refused the credential write' }
				},

				async unsetKey(route) {
					const credentials = remoteOf('credentials')
					if (credentials === undefined) return { ok: false, code: 'credentials-unavailable' }
					const ref = route.refs[0]
					if (ref === undefined) return { ok: false, message: 'this route names no credential reference' }
					const answer = await attempt(() => credentials.unset(ref))
					if (answer?.ok === true) return { ok: true }
					return { ok: false, message: answer?.error?.message ?? 'the Host refused the credential removal' }
				},

				async copyText(text) {
					try {
						if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
							await navigator.clipboard.writeText(text)
							return true
						}
					} catch {
						// Report the failure to the caller instead of throwing.
					}
					return false
				},

				openPlugins() {
					try {
						ctx.get('layout')?.selectPanel?.('plugins')
						return true
					} catch {
						return false
					}
				},
			}
		}

		function Dot({ state }) {
			const extra = state === 'ok' ? ' kc-dotOk' : state === 'missing' ? ' kc-dotMissing' : ''
			return h('span', { className: 'kc-dot' + extra, 'aria-hidden': true })
		}

		function routeName(route, t) {
			const known = t('route.' + route.id + '.name')
			if (known !== 'route.' + route.id + '.name') return known
			return route.displayName ?? route.id
		}

		/**
		 * One route card: identity, endpoint, the write-only key field, the saved
		 * state, and the console link that hands out the key.
		 */
		function RouteCard({ route, t, onSave, onRemove, copyText }) {
			const [draft, setDraft] = React.useState('')
			const [revealed, setRevealed] = React.useState(false)
			const [busy, setBusy] = React.useState(null)
			const [notice, setNotice] = React.useState(undefined)
			const [confirming, setConfirming] = React.useState(false)
			const [copyState, setCopyState] = React.useState('idle')
			const mounted = React.useRef(true)
			React.useEffect(
				() => () => {
					mounted.current = false
				},
				[],
			)

			const state = route.configured === true ? 'ok' : route.configured === false ? 'missing' : 'unknown'
			const stateText = state === 'ok' ? t('configured') : state === 'missing' ? t('missing') : t('unknown')
			const readOnly = route.writable === false
			const locked = busy !== null || readOnly

			const submit = async (event) => {
				event.preventDefault()
				if (locked) return
				const value = draft.trim()
				if (value.length === 0) {
					setNotice({ kind: 'error', text: t('keyBlank') })
					return
				}
				if (!LEGAL_API_KEY.test(value) || ENV_LINE.test(value) || /^["'`].*["'`]$/u.test(value)) {
					setNotice({ kind: 'error', text: t('keyIllegal') })
					return
				}
				setBusy('save')
				setNotice(undefined)
				const outcome = await onSave(route, value)
				if (!mounted.current) return
				setBusy(null)
				if (outcome.ok) {
					setDraft('')
					setRevealed(false)
					setNotice({ kind: 'ok', text: t('saved') })
				} else {
					const detail = outcome.code === 'credentials-unavailable' ? t('credentialUnavailable') : t('saveError', { message: outcome.message ?? 'unknown' })
					setNotice({ kind: 'error', text: detail })
				}
			}

			const remove = async () => {
				if (locked) return
				setBusy('remove')
				setNotice(undefined)
				const outcome = await onRemove(route)
				if (!mounted.current) return
				setBusy(null)
				setConfirming(false)
				setNotice(
					outcome.ok
						? { kind: 'ok', text: t('removed') }
						: { kind: 'error', text: t('removeError', { message: outcome.message ?? 'unknown' }) },
				)
			}

			const copy = async () => {
				if (route.consoleUrl === null) return
				const ok = await copyText(route.consoleUrl)
				if (!mounted.current) return
				setCopyState(ok ? 'copied' : 'failed')
				window.setTimeout(() => {
					if (mounted.current) setCopyState('idle')
				}, 1600)
			}

			const inputId = 'kimi-connect-key-' + route.id
			const descKey = 'route.' + route.id + '.desc'
			const description = t(descKey) === descKey ? null : t(descKey)
			const copyLabel = copyState === 'copied' ? t('copied') : copyState === 'failed' ? t('copyFailed') : t('copy')

			return h(
				'div',
				{ className: 'kc-card', 'data-kimi-route': route.id },
				h(
					'div',
					{ className: 'kc-cardHead' },
					h(
						'div',
						{ className: 'kc-routeId' },
						h(Dot, { state }),
						h('span', { className: 'kc-routeName' }, routeName(route, t)),
						route.mode === null ? null : h('span', { className: 'kc-badge' }, t('mode.' + route.mode)),
						route.recommended === true ? h('span', { className: 'kc-badge kc-badgeAccent' }, t('recommended')) : null,
						route.active ? null : h('span', { className: 'kc-badge kc-badgeWarn' }, t('inactiveRoute')),
					),
					h(
						'div',
						{ className: 'kc-cardActions' },
						route.consoleUrl === null
							? null
							: h(
									'a',
									{
										className: 'kc-secondary',
										href: route.consoleUrl,
										target: '_blank',
										rel: 'noreferrer noopener',
									},
									t('getKey'),
								),
						route.consoleUrl === null
							? null
							: h('button', { type: 'button', className: 'kc-link', onClick: copy, title: route.consoleUrl }, copyLabel),
					),
				),
				description === null ? null : h('p', { className: 'kc-desc' }, description),
				h(
					'div',
					{ className: 'kc-meta' },
					h('span', null, t('endpoint')),
					h('code', { className: 'kc-code' }, route.baseURL ?? '—'),
				),
				h(
					'form',
					{ className: 'kc-form', onSubmit: submit },
					h('label', { className: 'kc-label', htmlFor: inputId }, t('keyLabel')),
					h(
						'div',
						{ className: 'kc-keyRow' },
						h(
							'div',
							{ className: 'kc-keyField' },
							h('input', {
								id: inputId,
								className: 'kc-input',
								type: revealed ? 'text' : 'password',
								value: draft,
								placeholder: t('keyPlaceholder'),
								autoComplete: 'new-password',
								spellCheck: false,
								autoCapitalize: 'off',
								disabled: locked,
								onChange: (event) => {
									setDraft(event.target.value)
								},
							}),
							h(
								'button',
								{
									type: 'button',
									className: 'kc-eye',
									onClick: () => setRevealed((value) => !value),
									'aria-pressed': revealed,
									title: revealed ? t('hide') : t('show'),
									disabled: locked,
								},
								revealed ? t('hide') : t('show'),
							),
						),
						h(
							'button',
							{ type: 'submit', className: 'kc-primary', disabled: locked || draft.trim().length === 0 },
							busy === 'save' ? t('saving') : t('save'),
						),
					),
					h(
						'div',
						{ className: 'kc-row' },
						h('span', { className: 'kc-state' }, h(Dot, { state }), stateText, readOnly ? h('span', { className: 'kc-badge' }, t('readOnly')) : null),
						route.configured !== true
							? null
							: confirming
								? h(
										'span',
										{ className: 'kc-confirm' },
										h('span', null, t('confirmRemove')),
										h('button', { type: 'button', className: 'kc-link kc-danger', onClick: remove, disabled: locked }, busy === 'remove' ? t('removing') : t('confirmYes')),
										h('button', { type: 'button', className: 'kc-link', onClick: () => setConfirming(false), disabled: locked }, t('confirmNo')),
									)
								: h('button', { type: 'button', className: 'kc-link kc-danger', onClick: () => setConfirming(true), disabled: locked }, t('remove')),
					),
					notice === undefined ? null : h('p', { className: 'kc-notice ' + (notice.kind === 'ok' ? 'kc-noticeOk' : 'kc-noticeErr'), role: 'status' }, notice.text),
				),
				h(
					'p',
					{ className: 'kc-hint' },
					t('refLabel') + ': ',
					route.refs.length === 0 ? '—' : route.refs.map((ref) => h('code', { className: 'kc-code', key: ref }, ref)),
				),
			)
		}

		/** The panel page: header, connection state, route cards, models, next step. */
		function KimiPanel(props) {
			const { t, loadSnapshot, setKey, unsetKey, subscribe, copyText, openPlugins } = props
			const [state, setState] = React.useState({ status: 'loading', data: undefined, error: undefined })
			const generation = React.useRef(0)
			const mounted = React.useRef(true)
			React.useEffect(
				() => () => {
					mounted.current = false
				},
				[],
			)

			const refresh = React.useCallback(async () => {
				const current = ++generation.current
				setState((previous) => ({
					status: previous.status === 'ready' ? 'refreshing' : 'loading',
					data: previous.data,
					error: undefined,
				}))
				try {
					const data = await loadSnapshot()
					if (!mounted.current || current !== generation.current) return
					setState({ status: 'ready', data })
				} catch (error) {
					if (!mounted.current || current !== generation.current) return
					setState({ status: 'error', data: undefined, error })
				}
			}, [loadSnapshot])

			React.useEffect(() => {
				void refresh()
			}, [refresh])

			React.useEffect(() => {
				if (typeof subscribe !== 'function') return undefined
				return subscribe(() => {
					void refresh()
				})
			}, [refresh, subscribe])

			const data = state.data
			const busy = state.status === 'refreshing'
			const errorText =
				state.error === undefined
					? null
					: state.error?.code === 'credentials-unavailable'
						? t('credentialUnavailable')
						: t('loadError', { message: messageOf(state.error) })

			const statusBanner = (() => {
				if (state.status === 'loading') {
					return h('p', { className: 'kc-hint', role: 'status' }, t('loading'))
				}
				if (state.status === 'error') {
					return h(
						'div',
						{ className: 'kc-banner kc-bannerError', role: 'alert' },
						h('span', { className: 'kc-bannerText' }, h('span', { className: 'kc-bannerBody' }, errorText)),
						h('button', { type: 'button', className: 'kc-secondary', onClick: () => void refresh() }, t('retry')),
					)
				}
				if (data === undefined) return null
				if (!data.anyActive) {
					return h(
						'div',
						{ className: 'kc-banner', role: 'status' },
						h(
							'span',
							{ className: 'kc-bannerText' },
							h('span', { className: 'kc-bannerTitle' }, t('providerMissingTitle')),
							h('span', { className: 'kc-bannerBody' }, t('providerMissingBody')),
						),
						typeof openPlugins === 'function'
							? h('button', { type: 'button', className: 'kc-secondary', onClick: () => openPlugins() }, t('openPlugins'))
							: null,
					)
				}
				if (data.credentialError === 'credentials-unavailable') {
					return h('div', { className: 'kc-banner kc-bannerError', role: 'alert' }, h('span', { className: 'kc-bannerText' }, h('span', { className: 'kc-bannerBody' }, t('credentialUnavailable'))))
				}
				if (typeof data.credentialError === 'string') {
					return h(
						'div',
						{ className: 'kc-banner kc-bannerError', role: 'alert' },
						h('span', { className: 'kc-bannerText' }, h('span', { className: 'kc-bannerBody' }, t('loadError', { message: data.credentialError }))),
					)
				}
				return null
			})()

			const catalogName = (group) => {
				const known = t('route.' + group.id + '.name')
				return known === 'route.' + group.id + '.name' ? group.name : known
			}

			return h(
				'section',
				{ className: 'kc-root', 'aria-label': t('title') },
				h('style', null, CSS),
				h(
					'div',
					{ className: 'kc-inner' },
					h(
						'header',
						{ className: 'kc-head' },
						h('span', { className: 'kc-mark' }, h(KimiMark, { size: 24 })),
						h(
							'div',
							{ className: 'kc-headText' },
							h('h1', { className: 'kc-title' }, t('title')),
							h('p', { className: 'kc-intro' }, t('intro')),
						),
						h(
							'div',
							{ className: 'kc-toolbar' },
							h(
								'a',
								{ className: 'kc-secondary', href: CODE_URL, target: '_blank', rel: 'noreferrer noopener' },
								t('codePage'),
							),
							h(
								'a',
								{ className: 'kc-secondary', href: ACCOUNT_URL, target: '_blank', rel: 'noreferrer noopener' },
								t('account'),
							),
							h(
								'button',
								{ type: 'button', className: 'kc-secondary', onClick: () => void refresh(), disabled: busy },
								busy ? t('refreshing') : t('refresh'),
							),
						),
					),
					statusBanner,
					data === undefined
						? null
						: h(
								'div',
								null,
								h('h2', { className: 'kc-sectionTitle' }, t('routesTitle')),
								h(
									'div',
									{ style: { display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' } },
									data.routes.map((route) => h(RouteCard, { key: route.id, route, t, onSave: setKey, onRemove: unsetKey, copyText })),
								),
							),
					data === undefined || !data.anyActive
						? null
						: h(
								'section',
								null,
								h('h2', { className: 'kc-sectionTitle' }, t('modelsTitle')),
								h(
									'div',
									{ className: 'kc-models', style: { marginTop: '10px' } },
									data.modelGroups.length === 0
										? h('p', { className: 'kc-hint' }, t('modelsEmpty'))
										: data.modelGroups.map((group) =>
												h(
													'div',
													{ className: 'kc-modelGroup', key: group.id },
													h('span', { className: 'kc-modelGroupName' }, catalogName(group)),
													group.models.map((model) => h('span', { className: 'kc-chip', key: model.id, title: model.id }, model.name)),
												),
											),
									data.catalogFailures.map((failure) =>
										h(
											'p',
											{ className: 'kc-notice kc-noticeErr', key: 'failure-' + failure.id, role: 'status' },
											t('modelsFailure', { message: failure.message }),
										),
									),
								),
							),
					h(
						'section',
						{ className: 'kc-next' },
						h('h2', { className: 'kc-nextTitle' }, t('nextTitle')),
						h('p', { className: 'kc-hint' }, t('nextBody')),
						h('p', { className: 'kc-hint' }, t('storeHint')),
					),
				),
			)
		}

		return {
			inject: ['slots', 'locale', 'remote'],
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, { en }), 'kimi-connect: english dictionary')
				ctx.effect(() => ctx.locale.register(NS, 'ru', ru), 'kimi-connect: russian dictionary')
				const t = ctx.locale.bind(NS)
				const operations = createOperations(ctx)
				const injected = () => ({ ...operations, t })
				ctx.slots.inject('main', () =>
					ctx.slots.register(
						{
							name: 'main',
							key: PANEL_ID,
							locale: NS,
							inject: injected,
						},
						KimiPanel,
					),
				)
				ctx.slots.inject('sidebar.panellist', () =>
					ctx.slots.register(
						{
							name: 'sidebar.panellist',
							id: PANEL_ID,
							order: 20,
							locale: NS,
							label: () => t('nav'),
						},
						SidebarIcon,
					),
				)
			},
		}
	},
})
