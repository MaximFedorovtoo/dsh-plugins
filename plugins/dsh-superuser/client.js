/**
 * `dsh-superuser` — browser half of the Superuser bundle.
 *
 * Three surfaces, all registered through `window.__ModuleLoader__` (no build
 * step, React comes from the browser module table):
 *
 * 1. `sidebar.panellist` — an original shield-and-bolt glyph whose list id
 *    `superuser` addresses the keyed `main` page below. Clicking the row opens
 *    the page, because a panellist id is the main-slot key.
 * 2. `main` key `superuser` — the page: a per-chat "Суперпользователь" switch
 *    (Full access / approval never versus Workspace Write / approval ask) and
 *    the "Универсальный MCP" server manager with an add-server form, per-server
 *    connect/disconnect/remove controls, expandable tool lists and a tool-call
 *    test box.
 * 3. `conversation.session.header.utilities` — a compact `SU` toggle in the
 *    chat header, plus a compact shield + `SU` button in the composer tool row
 *    (`conversation.input.left`, session-scoped). It is the session-scoped surface: root slots receive no
 *    session id, so this toggle publishes the current chat id into a small
 *    module store that the root page reads. Without it the page still renders
 *    and shows "Откройте чат".
 *
 * The Host half owns the JSON API under `/api/superuser/...`; this half never
 * talks to the Host through anything but same-origin `fetch` and never reads
 * the DOM. All visible strings are locale ids of the `superuser` namespace;
 * the inline dictionaries are the source of truth (the module format cannot
 * import JSON), and `locale/*.json` carry the plugin display metadata.
 */
window.__ModuleLoader__.load({
	id: 'dsh-superuser',
	factory(require) {
		const React = require('react')
		const h = React.createElement

		/** Client locale namespace owned by this plugin. */
		const NS = 'superuser'
		/** One id addresses the sidebar entry, the main page and the header toggle. */
		const PANEL_ID = 'superuser'
		const HEADER_TOGGLE_ID = 'superuser-toggle'
		const PANEL_ORDER = 24
		const HEADER_TOGGLE_ORDER = 100

		/** Host JSON API (fixed contract, all responses are `{ok, data|error}`). */
		const API = {
			state: '/api/superuser/state',
			permission: '/api/superuser/permission',
			servers: '/api/superuser/mcp/servers',
			call: '/api/superuser/mcp/call',
			windows: '/api/superuser/windows',
		}

		const TRANSPORTS = ['stdio', 'http']
		/** The only Windows actions the panel may post. */
		const WINDOWS_ACTIONS = ['enable', 'disable', 'restart']

		/* ------------------------------------------------------------------ *
		 * Dictionaries. EN is the key reference; RU is primary for the UI; all
		 * three languages must carry every id (verified by scripts/selfcheck).
		 * ------------------------------------------------------------------ */

		const EN = {
			nav: 'Superuser',
			title: 'Superuser',
			subtitle: 'Full file access and no confirmations — the agent works as you',
			sessionLabel: 'Current chat',
			sessionNone: 'No chat open',
			noSession: 'Open a chat',
			noSessionHint: 'Superuser mode is switched per chat. Open or create a chat to change it.',
			noAgent: 'The chat agent is not running yet',
			noAgentHint: 'Send the first message in this chat; the switch becomes available once the agent is live.',
			stateOn: 'ON',
			stateOff: 'OFF',
			switchAria: 'Superuser mode for the current chat',
			switchOnHint: 'Full access to files and no approval prompts — the agent acts as you.',
			switchOffHint: 'Workspace Write and approval prompts are back.',
			switchBusy: 'Switching…',
			toggleError: 'Could not switch the mode: {message}',
			permissionNull: 'The host reports no permission data yet.',
			effectiveMode: 'Mode: {preset}',
			sandboxBadge: 'sandbox: {value}',
			approvalBadge: 'approval: {value}',
			loading: 'Reading the state…',
			loadError: 'Could not read the state: {message}',
			refresh: 'Refresh',
			refreshing: 'Refreshing…',
			retry: 'Retry',
			mcpTitle: 'Universal MCP',
			mcpHint: 'Calls run in the background and do not block other tools or applications',
			mcpLoading: 'Reading MCP servers…',
			mcpError: 'Could not read the MCP servers: {message}',
			mcpEmpty: 'No MCP servers yet',
			mcpEmptyHint: 'Add a server below: stdio (a command) or http (a URL).',
			serversTitle: 'Servers',
			addTitle: 'Add a server',
			addHint: 'For stdio give the command and one argument per line; for http give the server URL.',
			name: 'Name',
			namePlaceholder: 'For example: desktop',
			transport: 'Transport',
			stdio: 'stdio (local process)',
			http: 'http (remote server)',
			command: 'Command',
			commandPlaceholder: 'npx, node or a full executable path',
			args: 'Arguments',
			argsPlaceholder: 'One argument per line',
			url: 'Server URL',
			urlPlaceholder: 'https://example.com/mcp',
			autoConnect: 'Connect automatically',
			add: 'Add server',
			adding: 'Adding…',
			addError: 'Could not add the server: {message}',
			addOk: 'Server added.',
			addNameRequired: 'Enter the server name.',
			addCommandRequired: 'Enter the command for a stdio server.',
			addUrlRequired: 'Enter the URL for an http server.',
			connect: 'Connect',
			connecting: 'Connecting…',
			disconnect: 'Disconnect',
			disconnecting: 'Disconnecting…',
			remove: 'Remove',
			removing: 'Removing…',
			confirmRemove: 'Remove the server “{name}”?',
			confirmYes: 'Remove',
			confirmNo: 'Cancel',
			serverActionError: 'The server request failed: {message}',
			transportBadge: 'transport: {value}',
			toolsTitle: 'Tools',
			toolsShow: 'Show tools',
			toolsHide: 'Hide tools',
			toolsCount: 'Tools: {count}',
			toolsEmpty: 'The server exposes no tools yet.',
			lastError: 'Last error: {message}',
			testTitle: 'Test a tool',
			testHint: 'Pick a connected server and a tool, put a JSON object in the arguments field and call it.',
			testServer: 'Server',
			testTool: 'Tool',
			testArgs: 'Arguments (JSON)',
			testCall: 'Call tool',
			testCalling: 'Calling…',
			testResult: 'Result',
			testError: 'Tool call failed: {message}',
			testJsonInvalid: 'The arguments must be a valid JSON object.',
			testMissing: 'Pick a server and a tool first.',
			testNoTools: 'Connect a server with tools first.',
			testEmptyResult: 'Empty result',
			testOk: 'The call went through.',
			argsHint: 'An empty field means an empty object.',
			statusConnected: 'connected',
			statusDisconnected: 'disconnected',
			statusStarting: 'starting',
			statusError: 'error',
			statusUnknown: 'unknown',
			suToggleOn: 'SU',
			suToggleOff: 'SU',
			suToggleAriaOn: 'Superuser is on for this chat. Click to turn it off.',
			suToggleAriaOff: 'Superuser is off for this chat. Click to turn it on.',
			suToggleLoading: 'Reading the superuser state…',
			suToggleError: 'Superuser state is unavailable',
			composerOn: 'SU · on',
			composerOff: 'SU',
			appMcpTitle: 'MCP for an application',
			appMcpHint: 'Type the application name only: the server name, command and arguments are filled in automatically. The server works only with that application, runs its calls in the background and reconnects automatically.',
			appMcpApp: 'Application',
			appMcpAppPlaceholder: 'For example: Kimi',
			appMcpConnect: 'Connect MCP to the application',
			appMcpConnecting: 'Connecting…',
			appMcpLoading: 'Loading running applications…',
			appMcpAppsFailed: 'The list of running applications is unavailable — type the name manually.',
			appMcpNeedApp: 'Enter the application name.',
			appMcpDone: 'Done: {count} tools for {app}',
			appMcpNotRunning: 'The application is not running — start it and the MCP will connect automatically.',
			appMcpError: 'Could not connect the MCP: {message}',
			appMcpModelLabel: 'Model command',
			appMcpModelHint: 'or just tell the agent “work in {app}” — it connects the MCP itself',
			copy: 'Copy',
			copied: 'Copied',
			copyFailed: 'Could not copy',
			windowsTitle: 'Windows: no confirmations',
			windowsExplain: 'UI Automation needs no separate permission. Elevated windows are reachable only while DSH itself runs as administrator. SmartScreen appears only for downloaded or unknown files and does not get in the way of installed applications.',
			windowsAdminLabel: 'DSH runs as administrator',
			windowsYes: 'yes',
			windowsNo: 'no',
			windowsUacLabel: 'UAC confirmations',
			windowsUacOn: 'on',
			windowsUacOff: 'off',
			windowsUacUnknown: 'unknown',
			windowsUacValues: 'Registry values',
			windowsAutostartLabel: 'Elevated autostart',
			windowsTaskYes: 'task exists',
			windowsTaskNo: 'no task',
			windowsRunLevel: 'RunLevel: {value}',
			windowsLog: 'Last setup log',
			windowsEnable: 'Disable OS confirmations',
			windowsEnabling: 'Enabling…',
			windowsEnableWarning: 'Windows will show exactly one consent prompt. After it, UAC confirmations stop appearing and DSH starts with administrator rights at sign-in.',
			windowsDisable: 'Restore previous state',
			windowsDisabling: 'Restoring…',
			windowsDisableConfirm: 'Restore the previous Windows settings (UAC and autostart)?',
			windowsDisableYes: 'Yes, restore',
			windowsRestart: 'Restart DSH as administrator',
			windowsRestartConfirm: 'The current DSH window will close. Sessions are saved. Restart with administrator rights?',
			windowsRestartYes: 'Restart',
			windowsCancel: 'Cancel',
			windowsPending: 'Waiting for the Windows confirmation…',
			windowsNeedAdmin: 'An administrator account is required: enable it in Windows and sign in with it.',
			windowsDoneEnable: 'Done: UAC confirmations are off and elevated autostart is configured.',
			windowsDoneDisable: 'Done: the previous Windows settings are restored.',
			windowsRestarting: 'DSH is restarting with administrator rights…',
			windowsTimeout: 'Windows did not report the change within 60 seconds. Check the status and retry.',
			windowsLoadError: 'Could not read the Windows state: {message}',
			windowsActionError: 'The action failed: {message}',
			appMcpNeedDesktop: 'The built-in "desktop" server was not found. Connect it in the server list above first.',
		}

		const RU = {
			nav: 'Суперпользователь',
			title: 'Суперпользователь',
			subtitle: 'Полный доступ к файлам и никаких подтверждений — агент работает от вашего лица',
			sessionLabel: 'Текущий чат',
			sessionNone: 'Чат не открыт',
			noSession: 'Откройте чат',
			noSessionHint: 'Режим суперпользователя включается для конкретного чата. Откройте или создайте чат, чтобы его переключить.',
			noAgent: 'Агент чата ещё не запущен',
			noAgentHint: 'Отправьте первое сообщение в этом чате — переключатель станет доступен, когда агент появится.',
			stateOn: 'ВКЛ',
			stateOff: 'ВЫКЛ',
			switchAria: 'Режим суперпользователя для текущего чата',
			switchOnHint: 'Полный доступ к файлам и никаких подтверждений — агент работает от вашего лица.',
			switchOffHint: 'Снова Workspace Write и запросы подтверждений.',
			switchBusy: 'Переключаю…',
			toggleError: 'Не удалось переключить режим: {message}',
			permissionNull: 'Хост пока не отдаёт данные о режиме.',
			effectiveMode: 'Режим: {preset}',
			sandboxBadge: 'sandbox: {value}',
			approvalBadge: 'approval: {value}',
			loading: 'Читаю состояние…',
			loadError: 'Не удалось прочитать состояние: {message}',
			refresh: 'Обновить',
			refreshing: 'Обновляю…',
			retry: 'Повторить',
			mcpTitle: 'Универсальный MCP',
			mcpHint: 'Вызовы идут в фоне и не блокируют другие инструменты и приложения',
			mcpLoading: 'Читаю MCP-серверы…',
			mcpError: 'Не удалось прочитать MCP-серверы: {message}',
			mcpEmpty: 'MCP-серверов пока нет',
			mcpEmptyHint: 'Добавьте сервер ниже: stdio (команда) или http (URL).',
			serversTitle: 'Серверы',
			addTitle: 'Добавить сервер',
			addHint: 'Для stdio укажите команду и по одному аргументу в строке; для http — URL сервера.',
			name: 'Имя',
			namePlaceholder: 'Например: desktop',
			transport: 'Транспорт',
			stdio: 'stdio (локальный процесс)',
			http: 'http (удалённый сервер)',
			command: 'Команда',
			commandPlaceholder: 'npx, node или полный путь к исполняемому файлу',
			args: 'Аргументы',
			argsPlaceholder: 'По одному аргументу в строке',
			url: 'URL сервера',
			urlPlaceholder: 'https://example.com/mcp',
			autoConnect: 'Подключать автоматически',
			add: 'Добавить сервер',
			adding: 'Добавляю…',
			addError: 'Не удалось добавить сервер: {message}',
			addOk: 'Сервер добавлен.',
			addNameRequired: 'Укажите имя сервера.',
			addCommandRequired: 'Укажите команду для stdio-сервера.',
			addUrlRequired: 'Укажите URL для http-сервера.',
			connect: 'Подключить',
			connecting: 'Подключаю…',
			disconnect: 'Отключить',
			disconnecting: 'Отключаю…',
			remove: 'Удалить',
			removing: 'Удаляю…',
			confirmRemove: 'Удалить сервер «{name}»?',
			confirmYes: 'Удалить',
			confirmNo: 'Отмена',
			serverActionError: 'Запрос к серверу не удался: {message}',
			transportBadge: 'транспорт: {value}',
			toolsTitle: 'Инструменты',
			toolsShow: 'Показать инструменты',
			toolsHide: 'Скрыть инструменты',
			toolsCount: 'Инструментов: {count}',
			toolsEmpty: 'Сервер пока не отдал инструментов.',
			lastError: 'Последняя ошибка: {message}',
			testTitle: 'Проверка инструмента',
			testHint: 'Выберите подключённый сервер и инструмент, введите JSON-объект аргументов и вызовите его.',
			testServer: 'Сервер',
			testTool: 'Инструмент',
			testArgs: 'Аргументы (JSON)',
			testCall: 'Вызвать инструмент',
			testCalling: 'Вызываю…',
			testResult: 'Результат',
			testError: 'Вызов инструмента не удался: {message}',
			testJsonInvalid: 'Аргументы должны быть корректным JSON-объектом.',
			testMissing: 'Сначала выберите сервер и инструмент.',
			testNoTools: 'Сначала подключите сервер с инструментами.',
			testEmptyResult: 'Пустой результат',
			testOk: 'Вызов прошёл.',
			argsHint: 'Пустое поле означает пустой объект.',
			statusConnected: 'подключён',
			statusDisconnected: 'отключён',
			statusStarting: 'запускается',
			statusError: 'ошибка',
			statusUnknown: 'неизвестно',
			suToggleOn: 'SU',
			suToggleOff: 'SU',
			suToggleAriaOn: 'Суперпользователь включён в этом чате. Нажмите, чтобы выключить.',
			suToggleAriaOff: 'Суперпользователь выключен в этом чате. Нажмите, чтобы включить.',
			suToggleLoading: 'Читаю состояние суперпользователя…',
			suToggleError: 'Состояние суперпользователя недоступно',
			composerOn: 'SU · вкл',
			composerOff: 'SU',
			appMcpTitle: 'MCP под приложение',
			appMcpHint: 'Укажите только приложение: имя сервера, команда и аргументы подставятся сами. Сервер работает только с этим приложением, выполняет вызовы в фоне и переподключается автоматически.',
			appMcpApp: 'Приложение',
			appMcpAppPlaceholder: 'Например: Kimi',
			appMcpConnect: 'Подключить MCP к приложению',
			appMcpConnecting: 'Подключаю…',
			appMcpLoading: 'Загружаю запущенные приложения…',
			appMcpAppsFailed: 'Список запущенных приложений не получен — имя можно ввести вручную.',
			appMcpNeedApp: 'Укажите приложение.',
			appMcpDone: 'Готово: {count} инструментов у {app}',
			appMcpNotRunning: 'Приложение не запущено — запустите его, MCP подключится автоматически.',
			appMcpError: 'Не удалось подключить MCP: {message}',
			appMcpModelLabel: 'Команда для модели',
			appMcpModelHint: 'или просто напишите агенту «работай в {app}» — он подключит MCP сам',
			copy: 'Копировать',
			copied: 'Скопировано',
			copyFailed: 'Не удалось скопировать',
			windowsTitle: 'Windows: без подтверждений',
			windowsExplain: 'UIA-доступность отдельного разрешения не требует. Окна с повышением прав доступны только когда DSH запущен от администратора. SmartScreen возникает только для скачанных или неизвестных файлов и работе с уже установленными программами не мешает.',
			windowsAdminLabel: 'DSH с правами администратора',
			windowsYes: 'да',
			windowsNo: 'нет',
			windowsUacLabel: 'UAC-подтверждения',
			windowsUacOn: 'включены',
			windowsUacOff: 'выключены',
			windowsUacUnknown: 'неизвестно',
			windowsUacValues: 'Значения реестра',
			windowsAutostartLabel: 'Автозапуск с правами администратора',
			windowsTaskYes: 'задача есть',
			windowsTaskNo: 'задачи нет',
			windowsRunLevel: 'RunLevel: {value}',
			windowsLog: 'Последний лог настройки',
			windowsEnable: 'Включить без подтверждений ОС',
			windowsEnabling: 'Включаю…',
			windowsEnableWarning: 'Windows покажет ровно один запрос согласия. После него UAC-подтверждения не появятся, а DSH будет запускаться с правами администратора при входе.',
			windowsDisable: 'Вернуть как было',
			windowsDisabling: 'Возвращаю…',
			windowsDisableConfirm: 'Вернуть прежние настройки Windows — UAC и автозапуск?',
			windowsDisableYes: 'Да, вернуть',
			windowsRestart: 'Перезапустить DSH с правами администратора',
			windowsRestartConfirm: 'Текущее окно DSH закроется. Сессии сохраняются. Перезапустить с правами администратора?',
			windowsRestartYes: 'Перезапустить',
			windowsCancel: 'Отмена',
			windowsPending: 'Ожидаем подтверждение Windows…',
			windowsNeedAdmin: 'Нужна учётная запись администратора: включите её в Windows и войдите под ней.',
			windowsDoneEnable: 'Готово: UAC-подтверждения отключены, автозапуск с правами администратора настроен.',
			windowsDoneDisable: 'Готово: прежние настройки Windows восстановлены.',
			windowsRestarting: 'DSH перезапускается с правами администратора…',
			windowsTimeout: 'Windows не сообщил об изменении за 60 секунд. Проверьте статус и повторите.',
			windowsLoadError: 'Не удалось прочитать состояние Windows: {message}',
			windowsActionError: 'Не удалось выполнить действие: {message}',
			appMcpNeedDesktop: 'Встроенный сервер «desktop» не найден. Сначала подключите его в списке серверов выше.',
		}

		const ZH = {
			nav: '超级用户',
			title: '超级用户',
			subtitle: '完全访问文件并且不再请求确认 — 智能体以你的身份工作',
			sessionLabel: '当前对话',
			sessionNone: '未打开对话',
			noSession: '请打开对话',
			noSessionHint: '超级用户模式按对话切换。打开或新建一个对话即可切换。',
			noAgent: '对话的智能体尚未启动',
			noAgentHint: '在该对话中发送第一条消息，智能体启动后开关即可使用。',
			stateOn: '开',
			stateOff: '关',
			switchAria: '当前对话的超级用户模式',
			switchOnHint: '完全访问文件且不请求确认 — 智能体以你的身份工作。',
			switchOffHint: '已恢复 Workspace Write 和确认提示。',
			switchBusy: '正在切换…',
			toggleError: '无法切换模式：{message}',
			permissionNull: '主机尚未提供权限数据。',
			effectiveMode: '模式：{preset}',
			sandboxBadge: 'sandbox：{value}',
			approvalBadge: 'approval：{value}',
			loading: '正在读取状态…',
			loadError: '无法读取状态：{message}',
			refresh: '刷新',
			refreshing: '正在刷新…',
			retry: '重试',
			mcpTitle: '通用 MCP',
			mcpHint: '调用在后台执行，不会阻塞其他工具和应用',
			mcpLoading: '正在读取 MCP 服务器…',
			mcpError: '无法读取 MCP 服务器：{message}',
			mcpEmpty: '还没有 MCP 服务器',
			mcpEmptyHint: '在下方添加服务器：stdio（命令）或 http（URL）。',
			serversTitle: '服务器',
			addTitle: '添加服务器',
			addHint: 'stdio 需要命令和每行一个参数；http 需要服务器 URL。',
			name: '名称',
			namePlaceholder: '例如：desktop',
			transport: '传输方式',
			stdio: 'stdio（本地进程）',
			http: 'http（远程服务器）',
			command: '命令',
			commandPlaceholder: 'npx、node 或可执行文件的完整路径',
			args: '参数',
			argsPlaceholder: '每行一个参数',
			url: '服务器 URL',
			urlPlaceholder: 'https://example.com/mcp',
			autoConnect: '自动连接',
			add: '添加服务器',
			adding: '正在添加…',
			addError: '无法添加服务器：{message}',
			addOk: '服务器已添加。',
			addNameRequired: '请输入服务器名称。',
			addCommandRequired: 'stdio 服务器需要命令。',
			addUrlRequired: 'http 服务器需要 URL。',
			connect: '连接',
			connecting: '正在连接…',
			disconnect: '断开',
			disconnecting: '正在断开…',
			remove: '删除',
			removing: '正在删除…',
			confirmRemove: '删除服务器“{name}”？',
			confirmYes: '删除',
			confirmNo: '取消',
			serverActionError: '服务器请求失败：{message}',
			transportBadge: '传输：{value}',
			toolsTitle: '工具',
			toolsShow: '显示工具',
			toolsHide: '隐藏工具',
			toolsCount: '工具数：{count}',
			toolsEmpty: '服务器尚未提供工具。',
			lastError: '最近的错误：{message}',
			testTitle: '测试工具',
			testHint: '选择已连接的服务器和工具，在参数框中填写 JSON 对象后调用。',
			testServer: '服务器',
			testTool: '工具',
			testArgs: '参数（JSON）',
			testCall: '调用工具',
			testCalling: '正在调用…',
			testResult: '结果',
			testError: '工具调用失败：{message}',
			testJsonInvalid: '参数必须是有效的 JSON 对象。',
			testMissing: '请先选择服务器和工具。',
			testNoTools: '请先连接一个有工具的服务器。',
			testEmptyResult: '结果为空',
			testOk: '调用成功。',
			argsHint: '留空表示空对象。',
			statusConnected: '已连接',
			statusDisconnected: '未连接',
			statusStarting: '正在启动',
			statusError: '错误',
			statusUnknown: '未知',
			suToggleOn: 'SU',
			suToggleOff: 'SU',
			suToggleAriaOn: '此对话的超级用户已开启。点击关闭。',
			suToggleAriaOff: '此对话的超级用户已关闭。点击开启。',
			suToggleLoading: '正在读取超级用户状态…',
			suToggleError: '超级用户状态不可用',
			composerOn: 'SU · 开',
			composerOff: 'SU',
			appMcpTitle: '为应用创建 MCP',
			appMcpHint: '只需填写应用名称：服务器名称、命令和参数会自动填写。服务器只与该应用配合工作，调用在后台执行并自动重连。',
			appMcpApp: '应用',
			appMcpAppPlaceholder: '例如：Kimi',
			appMcpConnect: '将 MCP 连接到应用',
			appMcpConnecting: '正在连接…',
			appMcpLoading: '正在加载运行中的应用…',
			appMcpAppsFailed: '无法获取运行中的应用列表 — 可以手动输入名称。',
			appMcpNeedApp: '请输入应用名称。',
			appMcpDone: '完成：{app} 有 {count} 个工具',
			appMcpNotRunning: '应用未运行 — 启动它后 MCP 会自动连接。',
			appMcpError: '无法连接 MCP：{message}',
			appMcpModelLabel: '模型命令',
			appMcpModelHint: '或者直接告诉智能体“在 {app} 中工作” — 它会自己连接 MCP',
			copy: '复制',
			copied: '已复制',
			copyFailed: '无法复制',
			windowsTitle: 'Windows：无确认提示',
			windowsExplain: 'UIA 无需单独授权。只有 DSH 以管理员身份运行时才能访问提权窗口。SmartScreen 只对下载或未知文件出现，不影响与已安装应用的工作。',
			windowsAdminLabel: 'DSH 以管理员身份运行',
			windowsYes: '是',
			windowsNo: '否',
			windowsUacLabel: 'UAC 确认',
			windowsUacOn: '已启用',
			windowsUacOff: '已禁用',
			windowsUacUnknown: '未知',
			windowsUacValues: '注册表值',
			windowsAutostartLabel: '以管理员身份自启动',
			windowsTaskYes: '任务存在',
			windowsTaskNo: '无任务',
			windowsRunLevel: 'RunLevel：{value}',
			windowsLog: '最近一次设置日志',
			windowsEnable: '关闭操作系统确认提示',
			windowsEnabling: '正在启用…',
			windowsEnableWarning: 'Windows 只会显示一次同意提示。之后不再出现 UAC 确认，DSH 将在登录时以管理员权限启动。',
			windowsDisable: '恢复原状',
			windowsDisabling: '正在恢复…',
			windowsDisableConfirm: '恢复之前的 Windows 设置（UAC 和自启动）？',
			windowsDisableYes: '是，恢复',
			windowsRestart: '以管理员权限重启 DSH',
			windowsRestartConfirm: '当前 DSH 窗口将关闭，会话会保存。以管理员权限重启？',
			windowsRestartYes: '重启',
			windowsCancel: '取消',
			windowsPending: '正在等待 Windows 确认…',
			windowsNeedAdmin: '需要管理员账户：请在 Windows 中启用并以其登录。',
			windowsDoneEnable: '完成：UAC 确认已关闭，已配置以管理员身份自启动。',
			windowsDoneDisable: '完成：之前的 Windows 设置已恢复。',
			windowsRestarting: 'DSH 正在以管理员权限重启…',
			windowsTimeout: 'Windows 在 60 秒内未报告更改。请检查状态后重试。',
			windowsLoadError: '无法读取 Windows 状态：{message}',
			windowsActionError: '操作失败：{message}',
			appMcpNeedDesktop: '未找到内置的“desktop”服务器。请先在上方服务器列表中连接它。',
		}

		/* ------------------------------------------------------------------ *
		 * Styles. Every color, radius and font is a host theme token with a
		 * plain fallback, so the page follows light/dark themes.
		 * ------------------------------------------------------------------ */

		const CSS = `
			.su-root{box-sizing:border-box;width:100%;height:100%;min-height:0;overflow-y:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
			.su-root *{box-sizing:border-box}
			.su-inner{max-width:760px;margin:0 auto;padding:32px 24px 64px;display:flex;flex-direction:column;gap:20px}
			.su-head{display:flex;align-items:flex-start;gap:12px}
			.su-mark{flex:none;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
			.su-headText{min-width:0;flex:1 1 auto}
			.su-title{margin:0;font-size:18px;line-height:26px;font-weight:600}
			.su-subtitle{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
			.su-toolbar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
			.su-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1));background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1));border-radius:16px}
			.su-cardHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
			.su-cardTitle{margin:0;font-size:15px;line-height:22px;font-weight:600}
			.su-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-height:20px}
			.su-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
			.su-badge{flex:none;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;padding:1px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
			.su-badgeOk{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
			.su-badgeErr{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
			.su-badgeWarn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
			.su-badgeAccent{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
			.su-code{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:1px 5px;word-break:break-all}
			.su-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
			.su-notice{margin:0;font-size:12px;line-height:18px}
			.su-ok{color:var(--dsw-alias-state-success-primary)}
			.su-err{color:var(--dsw-alias-state-error-primary)}
			.su-banner{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;border-radius:12px;border:.5px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
			.su-bannerText{flex:1 1 auto;min-width:0;font-size:13px;line-height:20px}
			.su-primary{flex:none;height:36px;padding:0 14px;border:none;border-radius:8px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);font:inherit;font-size:14px;cursor:pointer;white-space:nowrap}
			.su-primary:hover:not(:disabled){opacity:.92}
			.su-primary:disabled{opacity:.45;cursor:default}
			.su-secondary{flex:none;height:32px;padding:0 12px;display:inline-flex;align-items:center;justify-content:center;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
			.su-secondary:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
			.su-secondary:disabled{opacity:.5;cursor:default}
			.su-danger{color:var(--dsw-alias-state-error-primary)}
			.su-input,.su-select,.su-textarea{width:100%;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;outline:none}
			.su-input,.su-select{height:36px;padding:0 10px}
			.su-textarea{min-height:88px;padding:8px 10px;resize:vertical;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px}
			.su-input:focus,.su-select:focus,.su-textarea:focus{border-color:var(--dsw-alias-brand-primary)}
			.su-input:disabled,.su-select:disabled,.su-textarea:disabled{opacity:.6}
			.su-field{display:flex;flex-direction:column;gap:6px}
			.su-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
			.su-formGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
			.su-check{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
			.su-switchRow{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
			.su-switch{position:relative;flex:none;width:72px;height:38px;padding:0;border:none;border-radius:19px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .16s ease}
			.su-switch[aria-checked='true']{background:var(--dsw-alias-state-success-primary)}
			.su-switch:disabled{opacity:.45;cursor:default}
			.su-switchKnob{position:absolute;top:3px;left:3px;width:32px;height:32px;border-radius:50%;background:var(--dsw-alias-bg-base);box-shadow:0 1px 3px rgba(0,0,0,.28);transition:left .16s ease}
			.su-switch[aria-checked='true'] .su-switchKnob{left:37px}
			.su-switchState{font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary)}
			.su-server{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
			.su-serverHead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
			.su-serverName{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
			.su-serverTitle{font-size:14px;line-height:22px;font-weight:600}
			.su-serverActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
			.su-tools{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
			.su-tool{display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:18px}
			.su-toolName{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);color:var(--dsw-alias-label-primary)}
			.su-toolDesc{color:var(--dsw-alias-label-secondary)}
			.su-result{margin:0;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow:auto}
			.su-confirm{display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
			.su-sep{height:.5px;background:var(--dsw-alias-border-l1);margin:2px 0}
			.su-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-border-l2)}
			.su-dotOn{background:var(--dsw-alias-state-success-primary)}
			.su-dotErr{background:var(--dsw-alias-state-error-primary)}
			.su-headerToggle{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:13px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;font-weight:600;letter-spacing:.04em;cursor:pointer;white-space:nowrap}
			.su-headerToggle:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
			.su-headerToggle[data-on='true']{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
			.su-headerToggle:disabled{opacity:.5;cursor:default}
			.su-composerBtn{flex:none;display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;font-weight:600;letter-spacing:.03em;cursor:pointer;white-space:nowrap}
			.su-composerBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}
			.su-composerBtn[data-on='true']{color:var(--dsw-alias-state-success-primary)}
			.su-composerBtn:disabled{opacity:.5;cursor:default}
			.su-composerBtn svg{flex:none}
			.su-cardHeadText{min-width:0;flex:1 1 auto}
			.su-modelBlock{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
			.su-modelRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
			.su-modelRow .su-code{flex:1 1 auto;min-width:0;padding:4px 6px}
			.su-warning{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary)}
			.su-root :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
			@media (max-width:560px){.su-inner{padding:20px 14px 48px}.su-formGrid{grid-template-columns:1fr}.su-primary{width:100%}}
		`

		/* ------------------------------------------------------------------ *
		 * Helpers
		 * ------------------------------------------------------------------ */

		function messageOf(error) {
			if (error instanceof Error && error.message) return error.message
			return String(error)
		}

		function isRecord(value) {
			return value !== null && typeof value === 'object' && !Array.isArray(value)
		}

		function asArray(value) {
			return Array.isArray(value) ? value : []
		}

		/** Error with a stable code the UI can surface without leaking a stack. */
		function apiError(message, code) {
			const error = new Error(message)
			error.code = code
			return error
		}

		/**
		 * Same-origin JSON fetch with the Host envelope. A `{ok:false}` body and
		 * a non-2xx status both throw a readable Error carrying `code`.
		 */
		async function requestJson(path, options) {
			const init = Object.assign({ method: 'GET', credentials: 'same-origin' }, options || {})
			init.headers = Object.assign({ accept: 'application/json' }, (options && options.headers) || {})
			let response
			try {
				response = await fetch(path, init)
			} catch (error) {
				throw apiError(messageOf(error), 'network')
			}
			const payload = await response.json().catch(() => null)
			const failure = isRecord(payload) && isRecord(payload.error) ? payload.error : null
			if (!response.ok) {
				throw apiError(
					(failure && typeof failure.message === 'string' && failure.message) || 'HTTP ' + response.status,
					(failure && typeof failure.code === 'string' && failure.code) || 'http',
				)
			}
			if (!isRecord(payload) || payload.ok !== true) {
				throw apiError(
					(failure && typeof failure.message === 'string' && failure.message) || 'Unexpected response',
					(failure && typeof failure.code === 'string' && failure.code) || 'bad-response',
				)
			}
			return payload.data
		}

		function postJson(path, body) {
			return requestJson(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			})
		}

		/* ------------------------------------------------------------------ *
		 * Host API wrappers (paths and envelopes fixed by the Host contract)
		 * ------------------------------------------------------------------ */

		async function fetchState(sessionId) {
			const query = sessionId === null || sessionId === undefined ? '' : '?sessionId=' + encodeURIComponent(sessionId)
			const data = await requestJson(API.state + query)
			return isRecord(data) ? data : {}
		}

		async function postPermission(sessionId, enabled) {
			const data = await postJson(API.permission, { sessionId, enabled })
			return isRecord(data) ? data : {}
		}

		async function fetchServers() {
			const data = await requestJson(API.servers)
			return isRecord(data) ? asArray(data.servers) : []
		}

		async function postServerAction(action, server) {
			const data = await postJson(API.servers, { action, server })
			return isRecord(data) && isRecord(data.server) ? data.server : null
		}

		async function postToolCall(server, tool, args) {
			const data = await postJson(API.call, { server, tool, args })
			return isRecord(data) ? data.result : undefined
		}


		/** Flatten one MCP tool result to readable text (text blocks, structured JSON or plain JSON). */
		function toolResultText(result) {
			if (typeof result === 'string') return result
			if (!isRecord(result)) return ''
			const content = Array.isArray(result.content) ? result.content : []
			const texts = content
				.filter((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
				.map((block) => block.text)
			if (texts.length > 0) return texts.join('\n')
			if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent)
			return JSON.stringify(result)
		}

		/** Parse the \u0060apps\u0060 tool answer into [{name, pid}] whatever envelope the host uses. */
		function parseApps(result) {
			const text = toolResultText(result)
			let data = null
			try {
				data = JSON.parse(text)
			} catch (error) {
				data = null
			}
			const candidates = []
			if (isRecord(data)) {
				if (Array.isArray(data.apps)) candidates.push(...data.apps)
				else if (isRecord(data.data) && Array.isArray(data.data.apps)) candidates.push(...data.data.apps)
				else if (isRecord(data.result) && Array.isArray(data.result.apps)) candidates.push(...data.result.apps)
			}
			if (candidates.length === 0) {
				for (const match of text.matchAll(/"name"\s*:\s*"([^"]+)"/gu)) candidates.push({ name: match[1] })
			}
			const seen = new Set()
			const apps = []
			for (const app of candidates) {
				const name = isRecord(app) && typeof app.name === 'string' ? app.name.trim() : ''
				if (name === '' || seen.has(name)) continue
				seen.add(name)
				apps.push({ name, pid: isRecord(app) && typeof app.pid === 'number' ? app.pid : undefined })
			}
			return apps
		}

		/** Display name of a running application (the CLI returns "<App>.exe"). */
		function appDisplayName(name) {
			return String(name).replace(/\.exe$/iu, '')
		}


		/**
		 * Spawn-ready command/args for a copy of the built-in stdio server. The
		 * Host view renders the built-in launch as one display string
		 * ("<node> <desktop-mcp.js>"); a plain stdio server is spawned from
		 * command + args, so split that suffix back into an executable and its
		 * arguments. ELECTRON_RUN_AS_NODE keeps the bundled Electron binary usable
		 * as a Node interpreter when the Host itself is the desktop application.
		 */
		function builtinLaunch(server) {
			const command = typeof server.command === 'string' ? server.command : ''
			const args = asArray(server.args).map(String)
			const env = {}
			if (command !== '' && args.length > 0 && command.endsWith(' ' + args[0])) {
				return { command: command.slice(0, command.length - args[0].length - 1), args, env: { ELECTRON_RUN_AS_NODE: '1' } }
			}
			return { command, args, env: {} }
		}

		/** Server-name suffix for an application: "desktop-<slug>". */
		function appSlug(name) {
			const slug = appDisplayName(name)
				.toLowerCase()
				.replace(/[^a-z0-9]+/gu, '-')
				.replace(/^-+|-+$/gu, '')
			return slug === '' ? 'app' : slug.slice(0, 32)
		}

		async function fetchWindowsStatus() {
			const data = await requestJson(API.windows)
			return isRecord(data) ? data : {}
		}

		async function postWindowsAction(action) {
			const data = await postJson(API.windows, { action })
			return isRecord(data) ? data : {}
		}

		/* ------------------------------------------------------------------ *
		 * Session hint store: a session-scoped header toggle publishes the id
		 * of the chat it is mounted in; the root page reads it. Root slots have
		 * no session id of their own, so this is the bridge between the two.
		 * ------------------------------------------------------------------ */

		function createSessionHintStore() {
			let current = null
			const listeners = new Set()
			return {
				get() {
					return current
				},
				set(sessionId) {
					if (typeof sessionId !== 'string' || sessionId === '' || sessionId === current) return
					current = sessionId
					for (const listener of listeners) listener()
				},
				subscribe(listener) {
					listeners.add(listener)
					return () => {
						listeners.delete(listener)
					}
				},
			}
		}

		const useSyncExternalStore =
			typeof React.useSyncExternalStore === 'function'
				? React.useSyncExternalStore
				: function fallback(subscribe, getSnapshot) {
						const [value, setValue] = React.useState(getSnapshot)
						React.useEffect(() => {
							setValue(getSnapshot())
							return subscribe(() => setValue(getSnapshot()))
						}, [subscribe])
						return value
					}

		/** The chat whose main view currently retains a Session, if any. */
		function deriveSessionId(state) {
			if (!isRecord(state) || !isRecord(state.byId)) return null
			for (const id of Object.keys(state.byId)) {
				const summary = state.byId[id]
				if (isRecord(summary) && isRecord(summary.retainedBy) && typeof summary.retainedBy.mainView === 'number' && summary.retainedBy.mainView > 0) {
					return id
				}
			}
			return null
		}

		/**
		 * Resolve the open chat: the header toggle hint wins, then the standard
		 * root `useSessions` hook (the same derivation the frame's title uses).
		 */
		function useActiveSessionId(useSessions, store) {
			const hinted = useSyncExternalStore(store.subscribe, store.get, store.get)
			const selector = React.useCallback((state) => deriveSessionId(state), [])
			const derived = typeof useSessions === 'function' ? useSessions(selector) : null
			return hinted !== null && hinted !== undefined ? hinted : derived
		}


		/** props.sessionId from a session-scoped slot, or null when the chat is unknown. */
		function sessionIdOf(props) {
			return typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : null
		}

		/**
		 * Shared per-session superuser state: one fetch/toggle path reused by the
		 * chat-header toggle, the composer button and (indirectly) the panel.
		 */
		function useSessionSuperuser(sessionId, store) {
			const [enabled, setEnabled] = React.useState(false)
			const [status, setStatus] = React.useState('idle')
			const [busy, setBusy] = React.useState(false)
			const alive = React.useRef(true)

			React.useEffect(() => {
				alive.current = true
				if (sessionId !== null && sessionId !== undefined) store.set(sessionId)
				return () => {
					alive.current = false
				}
			}, [sessionId, store])

			React.useEffect(() => {
				if (sessionId === null || sessionId === undefined) {
					setStatus('idle')
					return undefined
				}
				let current = true
				setStatus('loading')
				fetchState(sessionId).then(
					(data) => {
						if (!current || !alive.current) return
						const permission = isRecord(data.permission) ? data.permission : null
						setEnabled(permission !== null && permission.enabled === true)
						setStatus('ready')
					},
					() => {
						if (!current || !alive.current) return
						setStatus('error')
					},
				)
				return () => {
					current = false
				}
			}, [sessionId])

			function toggle() {
				if (sessionId === null || sessionId === undefined || busy || status === 'loading' || status === 'error') return
				const next = !enabled
				setBusy(true)
				postPermission(sessionId, next).then(
					(data) => {
						if (!alive.current) return
						setBusy(false)
						const permission = isRecord(data.permission) ? data.permission : null
						setEnabled(permission !== null ? permission.enabled === true : next)
						setStatus('ready')
					},
					() => {
						if (!alive.current) return
						setBusy(false)
					},
				)
			}

			return { enabled, status, busy, toggle }
		}

		function statusClass(status) {
			if (status === 'connected') return 'su-badge su-badgeOk'
			if (status === 'error') return 'su-badge su-badgeErr'
			if (status === 'starting') return 'su-badge su-badgeWarn'
			return 'su-badge'
		}

		function statusText(t, status) {
			if (status === 'connected') return t('statusConnected')
			if (status === 'disconnected') return t('statusDisconnected')
			if (status === 'starting') return t('statusStarting')
			if (status === 'error') return t('statusError')
			return t('statusUnknown')
		}

		/** Render a host error as readable text without crashing the page. */
		function errorText(t, key, error) {
			return t(key, { message: messageOf(error) })
		}

		/* ------------------------------------------------------------------ *
		 * Glyphs
		 * ------------------------------------------------------------------ */

		/** Original shield + bolt mark drawn in currentColor. */
		function SuperuserGlyph({ size = 20 }) {
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 24 24',
					fill: 'none',
					'aria-hidden': true,
					focusable: 'false',
					style: { display: 'block' },
				},
				h('path', {
					d: 'M12 2.7 4.9 5.5v6c0 4.4 2.9 7.9 7.1 9.7 4.2-1.8 7.1-5.3 7.1-9.7v-6L12 2.7Z',
					stroke: 'currentColor',
					strokeWidth: '1.6',
					strokeLinejoin: 'round',
				}),
				h('path', { d: 'M13.2 7.1 9.2 12.7h2.5l-.9 4.2 4-5.6h-2.5l.9-4.2Z', fill: 'currentColor' }),
			)
		}

		/** Sidebar list glyph: the component itself is the icon. */
		function SidebarIcon(props) {
			const size = typeof props.size === 'number' && props.size > 0 ? props.size : 20
			const active = props.active === true
			return h(
				'span',
				{
					style: {
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: size,
						height: size,
						opacity: active ? 1 : 0.88,
					},
				},
				h(SuperuserGlyph, { size: Math.max(14, Math.round(size * 0.92)) }),
			)
		}

		/* ------------------------------------------------------------------ *
		 * Shared small components
		 * ------------------------------------------------------------------ */

		function Badge({ text, variant }) {
			const suffix = variant === 'ok' ? ' su-badgeOk' : variant === 'err' ? ' su-badgeErr' : variant === 'warn' ? ' su-badgeWarn' : variant === 'accent' ? ' su-badgeAccent' : ''
			return h('span', { className: 'su-badge' + suffix }, text)
		}

		function ErrorBanner({ text, onRetry, retryLabel }) {
			return h(
				'div',
				{ className: 'su-banner', role: 'alert' },
				h('span', { className: 'su-bannerText' }, text),
				typeof onRetry === 'function'
					? h('button', { type: 'button', className: 'su-secondary', onClick: onRetry }, retryLabel)
					: null,
			)
		}

		/* ------------------------------------------------------------------ *
		 * Block 1: the per-chat superuser switch
		 * ------------------------------------------------------------------ */

		function PermissionCard({ t, sessionId, state, busy, error, onToggle, onRefresh }) {
			const permission = isRecord(state.permission) ? state.permission : null
			const enabled = permission !== null && permission.enabled === true
			const hasAgent = permission !== null
			// The host answers with `session: null` when it does not know the chat any more.
			const sessionMissing = sessionId !== null && sessionId !== undefined && state.status === 'ready' && state.session === null
			const disabled = sessionId === null || sessionId === undefined || busy || !hasAgent || state.status === 'loading' || state.status === 'error'

			const switchRow = h(
				'div',
				{ className: 'su-switchRow' },
				h(
					'button',
					{
						type: 'button',
						className: 'su-switch',
						role: 'switch',
						'aria-checked': enabled ? 'true' : 'false',
						'aria-label': t('switchAria'),
						disabled,
						onClick: () => onToggle(!enabled),
					},
					h('span', { className: 'su-switchKnob' }),
				),
				h('span', { className: 'su-switchState' }, busy ? t('switchBusy') : enabled ? t('stateOn') : t('stateOff')),
				h('span', { className: 'su-hint', style: { flex: '1 1 220px' } }, enabled ? t('switchOnHint') : t('switchOffHint')),
			)

			const badges =
				permission === null
					? null
					: h(
							'div',
							{ className: 'su-meta' },
							Badge({ text: t('effectiveMode', { preset: String(permission.preset ?? '—') }), variant: enabled ? 'ok' : undefined }),
							h('span', { className: 'su-badge' }, t('sandboxBadge', { value: String(permission.sandbox ?? '—') })),
							h('span', { className: 'su-badge' }, t('approvalBadge', { value: String(permission.approval ?? '—') })),
						)

			let body
			if (sessionId === null || sessionId === undefined || sessionMissing) {
				body = h(
					'div',
					{ className: 'su-card', role: 'status' },
					h(
						'div',
						null,
						h('div', { className: 'su-row' }, h('span', { className: 'su-serverTitle' }, t('noSession'))),
						h('p', { className: 'su-hint' }, t('noSessionHint')),
					),
					switchRow,
				)
			} else {
				body = h(
					'div',
					{ className: 'su-card' },
					h(
						'div',
						{ className: 'su-cardHead' },
						h(
							'div',
							{ className: 'su-serverName' },
							h('h2', { className: 'su-cardTitle' }, t('title')),
							h('span', { className: 'su-meta' }, h('span', { className: 'su-dot' + (enabled ? ' su-dotOn' : '') }), t('sessionLabel') + ': ', h('span', { className: 'su-code' }, String(sessionId))),
						),
						h('button', { type: 'button', className: 'su-secondary', onClick: onRefresh, disabled: busy || state.status === 'loading' }, state.status === 'loading' ? t('refreshing') : t('refresh')),
					),
					state.status === 'loading' ? h('p', { className: 'su-hint' }, t('loading')) : null,
					state.status === 'error' ? h(ErrorBanner, { text: errorText(t, 'loadError', error), onRetry: onRefresh, retryLabel: t('retry') }) : null,
					state.status !== 'loading' && state.status !== 'error' && !hasAgent
						? h('p', { className: 'su-hint' }, t('noAgent') + ' — ' + t('noAgentHint'))
						: null,
					state.status !== 'loading' && state.status !== 'error' ? h('p', { className: 'su-subtitle' }, t('subtitle')) : null,
					switchRow,
					badges,
					error !== '' && state.status !== 'error' ? h('p', { className: 'su-notice su-err', role: 'alert' }, errorText(t, 'toggleError', error)) : null,
				)
			}

			return h('section', { 'aria-label': t('title') }, body)
		}

		/* ------------------------------------------------------------------ *
		 * Block 2: the universal MCP hub
		 * ------------------------------------------------------------------ */

		/** One configured server: status, toggles, tools, last error. */
		function ServerRow({ t, server, busy, autoExpand, onConnect, onDisconnect, onRemove }) {
			const [expanded, setExpanded] = React.useState(false)
			const [confirming, setConfirming] = React.useState(false)

			// The app-bound flow selects a freshly created server and opens its tools.
			React.useEffect(() => {
				if (autoExpand === true) setExpanded(true)
			}, [autoExpand])
			const tools = asArray(server.tools)
			const connected = server.status === 'connected'
			const starting = server.status === 'starting'
			const actionBusy = busy !== ''

			const toolList = (() => {
				if (!expanded) return null
				if (tools.length === 0) return h('p', { className: 'su-hint' }, t('toolsEmpty'))
				return h(
					'div',
					{ className: 'su-tools' },
					tools.map((tool, index) => {
						const name = typeof tool.name === 'string' ? tool.name : 'tool-' + index
						const title = typeof tool.title === 'string' && tool.title !== '' ? tool.title : name
						return h(
							'div',
							{ className: 'su-tool', key: name },
							h('span', { className: 'su-toolName' }, title),
							typeof tool.description === 'string' && tool.description !== ''
								? h('span', { className: 'su-toolDesc' }, tool.description)
								: null,
						)
					}),
				)
			})()

			return h(
				'div',
				{ className: 'su-server' },
				h(
					'div',
					{ className: 'su-serverHead' },
					h(
						'div',
						{ className: 'su-serverName' },
						h('span', { className: 'su-serverTitle' }, typeof server.label === 'string' && server.label !== '' ? server.label : String(server.name ?? server.id ?? 'server')),
						h('span', { className: statusClass(server.status) }, statusText(t, server.status)),
						Badge({ text: t('transportBadge', { value: String(server.transport ?? 'stdio') }) }),
						h('span', { className: 'su-code' }, String(server.id ?? '')),
					),
					h(
						'div',
						{ className: 'su-serverActions' },
						h('button', { type: 'button', className: 'su-secondary', onClick: () => setExpanded((value) => !value), disabled: actionBusy }, expanded ? t('toolsHide') : t('toolsShow') + ' (' + String(tools.length) + ')'),
						connected
							? h('button', { type: 'button', className: 'su-secondary', onClick: onDisconnect, disabled: actionBusy }, busy === 'disconnect' ? t('disconnecting') : t('disconnect'))
							: h('button', { type: 'button', className: 'su-secondary', onClick: onConnect, disabled: actionBusy || starting }, busy === 'connect' ? t('connecting') : t('connect')),
						confirming
							? h(
									'span',
									{ className: 'su-confirm' },
									t('confirmRemove', { name: String(server.name ?? server.id ?? '') }),
									h('button', { type: 'button', className: 'su-secondary su-danger', onClick: () => { setConfirming(false); onRemove() }, disabled: actionBusy }, busy === 'remove' ? t('removing') : t('confirmYes')),
									h('button', { type: 'button', className: 'su-secondary', onClick: () => setConfirming(false), disabled: actionBusy }, t('confirmNo')),
								)
							: h('button', { type: 'button', className: 'su-secondary su-danger', onClick: () => setConfirming(true), disabled: actionBusy }, t('remove')),
					),
				),
				typeof server.lastError === 'string' && server.lastError !== '' ? h('p', { className: 'su-hint su-err' }, t('lastError', { message: server.lastError })) : null,
				expanded ? h('p', { className: 'su-hint' }, t('toolsCount', { count: tools.length })) : null,
				toolList,
			)
		}

		/** Add-server form. */
		function AddServerForm({ t, busy, onAdd }) {
			const [name, setName] = React.useState('')
			const [transport, setTransport] = React.useState('stdio')
			const [command, setCommand] = React.useState('')
			const [args, setArgs] = React.useState('')
			const [url, setUrl] = React.useState('')
			const [autoConnect, setAutoConnect] = React.useState(true)
			const [error, setError] = React.useState('')
			const [notice, setNotice] = React.useState('')

			function submit() {
				setError('')
				setNotice('')
				const trimmedName = name.trim()
				if (trimmedName === '') return setError(t('addNameRequired'))
				const server = { name: trimmedName, transport, autoConnect }
				if (transport === 'stdio') {
					const trimmedCommand = command.trim()
					if (trimmedCommand === '') return setError(t('addCommandRequired'))
					server.command = trimmedCommand
					server.args = args
						.split(/\r?\n/u)
						.map((line) => line.trim())
						.filter((line) => line !== '')
				} else {
					const trimmedUrl = url.trim()
					if (trimmedUrl === '') return setError(t('addUrlRequired'))
					server.url = trimmedUrl
				}
				onAdd(server).then(
					() => {
						setNotice(t('addOk'))
						setName('')
						setCommand('')
						setArgs('')
						setUrl('')
					},
					(submitError) => setError(errorText(t, 'addError', submitError)),
				)
			}

			return h(
				'div',
				{ className: 'su-card' },
				h('h3', { className: 'su-cardTitle' }, t('addTitle')),
				h('p', { className: 'su-hint' }, t('addHint')),
				h(
					'div',
					{ className: 'su-formGrid' },
					h(
						'label',
						{ className: 'su-field' },
						h('span', { className: 'su-label' }, t('name')),
						h('input', {
							className: 'su-input',
							type: 'text',
							value: name,
							placeholder: t('namePlaceholder'),
							onChange: (event) => setName(event.target.value),
							disabled: busy,
						}),
					),
					h(
						'label',
						{ className: 'su-field' },
						h('span', { className: 'su-label' }, t('transport')),
						h(
							'select',
							{ className: 'su-select', value: transport, onChange: (event) => setTransport(event.target.value), disabled: busy },
							TRANSPORTS.map((item) => h('option', { value: item, key: item }, t(item))),
						),
					),
				),
				transport === 'stdio'
					? h(
							'div',
							{ className: 'su-formGrid' },
							h(
								'label',
								{ className: 'su-field' },
								h('span', { className: 'su-label' }, t('command')),
								h('input', {
									className: 'su-input',
									type: 'text',
									value: command,
									placeholder: t('commandPlaceholder'),
									onChange: (event) => setCommand(event.target.value),
									disabled: busy,
								}),
							),
							h(
								'label',
								{ className: 'su-field' },
								h('span', { className: 'su-label' }, t('args')),
								h('textarea', {
									className: 'su-textarea',
									value: args,
									placeholder: t('argsPlaceholder'),
									onChange: (event) => setArgs(event.target.value),
									disabled: busy,
								}),
							),
						)
					: h(
							'label',
							{ className: 'su-field' },
							h('span', { className: 'su-label' }, t('url')),
							h('input', {
								className: 'su-input',
								type: 'text',
								value: url,
								placeholder: t('urlPlaceholder'),
								onChange: (event) => setUrl(event.target.value),
								disabled: busy,
							}),
						),
				h(
					'label',
					{ className: 'su-check' },
					h('input', { type: 'checkbox', checked: autoConnect, onChange: (event) => setAutoConnect(event.target.checked), disabled: busy }),
					t('autoConnect'),
				),
				h(
					'div',
					{ className: 'su-row', style: { justifyContent: 'flex-start' } },
					h('button', { type: 'button', className: 'su-primary', onClick: submit, disabled: busy }, busy ? t('adding') : t('add')),
				),
				error !== '' ? h('p', { className: 'su-notice su-err', role: 'alert' }, error) : null,
				notice !== '' ? h('p', { className: 'su-notice su-ok', role: 'status' }, notice) : null,
			)
		}

		/** Call one tool on a connected server and show the result. */
		function ToolTestBox({ t, servers }) {
			const connected = servers.filter((server) => server.status === 'connected' && asArray(server.tools).length > 0)
			const [serverId, setServerId] = React.useState('')
			const [toolName, setToolName] = React.useState('')
			const [argsText, setArgsText] = React.useState('{}')
			const [busy, setBusy] = React.useState(false)
			const [result, setResult] = React.useState(null)
			const [error, setError] = React.useState('')
			const [notice, setNotice] = React.useState('')

			const selected = connected.find((server) => String(server.id) === serverId) || null
			const tools = selected !== null ? asArray(selected.tools) : []
			const effectiveTool = toolName !== '' && tools.some((tool) => tool.name === toolName) ? toolName : tools.length > 0 ? String(tools[0].name) : ''

			function submit() {
				setError('')
				setNotice('')
				setResult(null)
				if (connected.length === 0) return setError(t('testNoTools'))
				if (selected === null || effectiveTool === '') return setError(t('testMissing'))
				let parsed
				try {
					parsed = argsText.trim() === '' ? {} : JSON.parse(argsText)
				} catch (parseError) {
					return setError(t('testJsonInvalid'))
				}
				if (!isRecord(parsed)) return setError(t('testJsonInvalid'))
				setBusy(true)
				postToolCall(serverId, effectiveTool, parsed).then(
					(value) => {
						setBusy(false)
						setNotice(t('testOk'))
						setResult(value === undefined ? t('testEmptyResult') : typeof value === 'string' ? value : JSON.stringify(value, null, 2))
					},
					(callError) => {
						setBusy(false)
						setError(errorText(t, 'testError', callError))
					},
				)
			}

			return h(
				'div',
				{ className: 'su-card' },
				h('h3', { className: 'su-cardTitle' }, t('testTitle')),
				h('p', { className: 'su-hint' }, t('testHint')),
				connected.length === 0
					? h('p', { className: 'su-hint' }, t('testNoTools'))
					: h(
							'div',
							{ className: 'su-formGrid' },
							h(
								'label',
								{ className: 'su-field' },
								h('span', { className: 'su-label' }, t('testServer')),
								h(
									'select',
									{
										className: 'su-select',
										value: serverId,
										onChange: (event) => {
											setServerId(event.target.value)
											setToolName('')
											setResult(null)
											setError('')
											setNotice('')
										},
										disabled: busy,
									},
									h('option', { value: '' }, '—'),
									connected.map((server) => h('option', { value: String(server.id), key: String(server.id) }, String(server.label ?? server.name ?? server.id))),
								),
							),
							h(
								'label',
								{ className: 'su-field' },
								h('span', { className: 'su-label' }, t('testTool')),
								h(
									'select',
									{
										className: 'su-select',
										value: effectiveTool,
										onChange: (event) => setToolName(event.target.value),
										disabled: busy || selected === null,
									},
									tools.length === 0 ? h('option', { value: '' }, '—') : tools.map((tool) => h('option', { value: String(tool.name), key: String(tool.name) }, String(tool.title ?? tool.name))),
								),
							),
						),
				connected.length === 0
					? null
					: h(
							'label',
							{ className: 'su-field' },
							h('span', { className: 'su-label' }, t('testArgs')),
							h('textarea', { className: 'su-textarea', value: argsText, onChange: (event) => setArgsText(event.target.value), disabled: busy, spellCheck: false }),
							h('span', { className: 'su-hint' }, t('argsHint')),
						),
				connected.length === 0 ? null : h('div', { className: 'su-row', style: { justifyContent: 'flex-start' } }, h('button', { type: 'button', className: 'su-primary', onClick: submit, disabled: busy }, busy ? t('testCalling') : t('testCall'))),
				error !== '' ? h('p', { className: 'su-notice su-err', role: 'alert' }, error) : null,
				notice !== '' ? h('p', { className: 'su-notice su-ok', role: 'status' }, notice) : null,
				result !== null ? h('div', { className: 'su-field' }, h('span', { className: 'su-label' }, t('testResult')), h('pre', { className: 'su-result' }, result)) : null,
			)
		}


		/** Small async pause used while a newly created server connects. */
		function delay(ms) {
			return new Promise((resolve) => setTimeout(resolve, ms))
		}

		/** Find one server view by id or name, case-insensitively. */
		function findServerView(servers, idOrName) {
			const wanted = String(idOrName).toLowerCase()
			return (
				servers.find(
					(server) => String(server.id ?? '').toLowerCase() === wanted || String(server.name ?? '').toLowerCase() === wanted,
				) ?? null
			)
		}

		/** One-line model-facing invocation that creates/connects the app-bound MCP. */
		function modelCommand(app) {
			return 'mcp_manage ' + JSON.stringify({ action: 'app', app })
		}

		/** Poll the server list until the target server reports connected, failed or tools. */
		async function waitForServer(idOrName, attempts) {
			let found = null
			for (let index = 0; index < attempts; index += 1) {
				const servers = await fetchServers()
				found = findServerView(servers, idOrName)
				if (found !== null && (found.status === 'connected' || found.status === 'error' || asArray(found.tools).length > 0)) return found
				if (index + 1 < attempts) await delay(600)
			}
			return found
		}

		/**
		 * "MCP for an application" flow: the user names an application and the client
		 * derives everything else from the built-in desktop server (name, label,
		 * transport, command, args, DSH_MCP_TARGET_APP). An existing server with the
		 * derived name is reconnected instead of duplicated.
		 */
		function AppMcpCreator({ t, onCreated }) {
			const [appQuery, setAppQuery] = React.useState('')
			const [apps, setApps] = React.useState([])
			const [appsStatus, setAppsStatus] = React.useState('loading')
			const [busy, setBusy] = React.useState(false)
			const [error, setError] = React.useState('')
			const [result, setResult] = React.useState(null)
			const [copied, setCopied] = React.useState('')
			const copyTimer = React.useRef(null)
			const alive = React.useRef(true)

			React.useEffect(
				() => () => {
					if (copyTimer.current !== null) clearTimeout(copyTimer.current)
				},
				[],
			)

			/** Copy the model command; the feedback line clears itself. */
			function copyCommand(text) {
				const finish = (message) => {
					setCopied(message)
					if (copyTimer.current !== null) clearTimeout(copyTimer.current)
					copyTimer.current = setTimeout(() => setCopied(''), 2000)
				}
				const clipboard = typeof navigator !== 'undefined' && navigator.clipboard !== undefined ? navigator.clipboard : null
				if (clipboard === null || typeof clipboard.writeText !== 'function') return finish(t('copyFailed'))
				clipboard.writeText(text).then(
					() => finish(t('copied')),
					() => finish(t('copyFailed')),
				)
			}

			const loadApps = React.useCallback(() => {
				setAppsStatus('loading')
				postToolCall('desktop', 'apps', {}).then(
					(value) => {
						if (!alive.current) return
						setApps(parseApps(value))
						setAppsStatus('ready')
					},
					() => {
						if (!alive.current) return
						setAppsStatus('error')
					},
				)
			}, [])

			React.useEffect(() => {
				alive.current = true
				loadApps()
				return () => {
					alive.current = false
				}
			}, [loadApps])

			const matched = React.useMemo(() => {
				const query = appQuery.trim().toLowerCase()
				if (query === '') return null
				return (
					apps.find((app) => app.name.toLowerCase() === query || appDisplayName(app.name).toLowerCase() === query) ?? null
				)
			}, [appQuery, apps])

			/** Connect (or reconnect) the app-bound server; one name is the only input. */
			async function connect() {
				setError('')
				setResult(null)
				const typed = appQuery.trim()
				if (typed === '') return setError(t('appMcpNeedApp'))
				setBusy(true)
				try {
					if (appsStatus !== 'ready') loadApps()
					const appName = matched !== null ? matched.name : typed
					const display = appDisplayName(appName)
					const serverName = 'desktop-' + appSlug(appName)
					const servers = await fetchServers()
					const existing = findServerView(servers, serverName)
					let finalServer = existing
					if (existing !== null) {
						if (existing.status !== 'connected') await postServerAction('connect', { id: existing.id })
						finalServer = await waitForServer(serverName, 6)
					} else {
						const desktop =
							servers.find(
								(server) =>
									String(server.name ?? '').toLowerCase() === 'desktop' ||
									String(server.id ?? '').toLowerCase() === 'desktop' ||
									server.builtin === true,
							) ?? null
						if (desktop === null) throw apiError(t('appMcpNeedDesktop'), 'no-desktop-server')
						const launch = builtinLaunch(desktop)
						if (launch.command === '') throw apiError(t('appMcpNeedDesktop'), 'no-desktop-server')
						await postServerAction('add', {
							name: serverName,
							label: display + ' — MCP',
							transport: 'stdio',
							command: launch.command,
							args: launch.args,
							env: Object.assign({ DSH_MCP_TARGET_APP: appName }, launch.env),
							autoConnect: true,
						})
						finalServer = await waitForServer(serverName, 6)
					}
					if (!alive.current) return
					const count = finalServer !== null ? asArray(finalServer.tools).length : 0
					setResult({ app: display, count, running: matched !== null || appsStatus !== 'ready' })
					if (typeof onCreated === 'function') onCreated(finalServer)
				} catch (failure) {
					if (!alive.current) return
					if (failure instanceof Error && failure.code === 'no-desktop-server') setError(messageOf(failure))
					else setError(errorText(t, 'appMcpError', failure))
				} finally {
					if (alive.current) setBusy(false)
				}
			}

			return h(
				'div',
				{ className: 'su-card' },
				h('h3', { className: 'su-cardTitle' }, t('appMcpTitle')),
				h('p', { className: 'su-hint' }, t('appMcpHint')),
				h(
					'label',
					{ className: 'su-field' },
					h('span', { className: 'su-label' }, t('appMcpApp')),
					h('input', {
						className: 'su-input',
						type: 'text',
						value: appQuery,
						placeholder: t('appMcpAppPlaceholder'),
						list: 'su-app-options',
						onChange: (event) => setAppQuery(event.target.value),
						disabled: busy,
					}),
					apps.length === 0
						? null
						: h(
								'datalist',
								{ id: 'su-app-options' },
								apps.map((app) => h('option', { value: app.name, key: app.name, label: appDisplayName(app.name) })),
							),
					appsStatus === 'loading' ? h('span', { className: 'su-hint' }, t('appMcpLoading')) : null,
					appsStatus === 'error' ? h('span', { className: 'su-hint' }, t('appMcpAppsFailed')) : null,
				),
				h(
					'div',
					{ className: 'su-row', style: { justifyContent: 'flex-start' } },
					h('button', { type: 'button', className: 'su-primary', onClick: () => void connect(), disabled: busy }, busy ? t('appMcpConnecting') : t('appMcpConnect')),
				),
				error !== '' ? h('p', { className: 'su-notice su-err', role: 'alert' }, error) : null,
				result !== null ? h('p', { className: 'su-notice su-ok', role: 'status' }, t('appMcpDone', { count: String(result.count), app: result.app })) : null,
				result !== null
					? h(
							'div',
							{ className: 'su-modelBlock' },
							h('span', { className: 'su-label' }, t('appMcpModelLabel')),
							h(
								'div',
								{ className: 'su-modelRow' },
								h('code', { className: 'su-code' }, modelCommand(result.app)),
								h('button', { type: 'button', className: 'su-secondary', onClick: () => copyCommand(modelCommand(result.app)) }, t('copy')),
							),
							h('p', { className: 'su-hint' }, t('appMcpModelHint', { app: result.app })),
							copied !== '' ? h('p', { className: 'su-notice su-ok', role: 'status' }, copied) : null,
						)
					: null,
				result !== null && !result.running ? h('p', { className: 'su-hint' }, t('appMcpNotRunning')) : null,
			)
		}

		/** Self-contained MCP block: own loading/error/empty state and mutations. */
		function McpSection({ t }) {
			const [servers, setServers] = React.useState([])
			const [status, setStatus] = React.useState('loading')
			const [error, setError] = React.useState('')

			const [rowBusy, setRowBusy] = React.useState({})
			const [actionError, setActionError] = React.useState('')
			const [addBusy, setAddBusy] = React.useState(false)
			const [autoExpandId, setAutoExpandId] = React.useState('')
			const alive = React.useRef(true)

			const load = React.useCallback(() => {
				setStatus((current) => (current === 'ready' ? 'refreshing' : 'loading'))
				setError('')
				fetchServers().then(
					(list) => {
						if (!alive.current) return
						setServers(list)
						setStatus('ready')
					},
					(loadError) => {
						if (!alive.current) return
						setError(messageOf(loadError))
						setStatus('error')
					},
				)
			}, [])

			React.useEffect(() => {
				alive.current = true
				load()
				return () => {
					alive.current = false
				}
			}, [load])

			function applyServer(updated) {
				if (updated === null) {
					load()
					return
				}
				setServers((current) => current.map((server) => (String(server.id) === String(updated.id) ? updated : server)))
			}

			function runAction(action, server) {
				setActionError('')
				setRowBusy((current) => Object.assign({}, current, { [String(server.id)]: action }))
				postServerAction(action, server).then(
					(updated) => {
						if (!alive.current) return
						setRowBusy((current) => {
							const next = Object.assign({}, current)
							delete next[String(server.id)]
							return next
						})
						if (action === 'remove') {
							setServers((current) => current.filter((item) => String(item.id) !== String(server.id)))
						} else {
							applyServer(updated)
						}
					},
					(actionFailure) => {
						if (!alive.current) return
						setRowBusy((current) => {
							const next = Object.assign({}, current)
							delete next[String(server.id)]
							return next
						})
						setActionError(errorText(t, 'serverActionError', actionFailure))
					},
				)
			}

			function addServer(server) {
				setActionError('')
				setAddBusy(true)
				return postServerAction('add', server).then(
					(added) => {
						if (alive.current) {
							setAddBusy(false)
							if (added !== null) setServers((current) => current.concat([added]))
							else load()
						}
					},
					(addFailure) => {
						if (alive.current) setAddBusy(false)
						throw addFailure
					},
				)
			}

			const refreshing = status === 'loading' || status === 'refreshing'

			return h(
				'section',
				{ 'aria-label': t('mcpTitle') },
				h(
					'div',
					{ className: 'su-card' },
					h(
						'div',
						{ className: 'su-cardHead' },
						h(
							'div',
							null,
							h('h2', { className: 'su-cardTitle' }, t('mcpTitle')),
							h('p', { className: 'su-hint' }, t('mcpHint')),
						),
						h('button', { type: 'button', className: 'su-secondary', onClick: load, disabled: refreshing }, refreshing ? t('refreshing') : t('refresh')),
					),
					status === 'loading' ? h('p', { className: 'su-hint' }, t('mcpLoading')) : null,
					status === 'error' ? h(ErrorBanner, { text: t('mcpError', { message: error }), onRetry: load, retryLabel: t('retry') }) : null,
					actionError !== '' ? h('p', { className: 'su-notice su-err', role: 'alert' }, actionError) : null,
					status !== 'loading' && status !== 'error' && servers.length === 0
						? h(
								'div',
								{ style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
								h('p', { className: 'su-serverTitle' }, t('mcpEmpty')),
								h('p', { className: 'su-hint' }, t('mcpEmptyHint')),
							)
						: null,
				),
				h(
					'div',
					{ style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
					h('h3', { className: 'su-cardTitle' }, t('serversTitle')),
					servers.map((server) =>
						h(ServerRow, {
							key: String(server.id ?? server.name),
							t,
							server,
							busy: rowBusy[String(server.id)] ?? '',
							autoExpand: autoExpandId !== '' && String(server.id) === autoExpandId,
							onConnect: () => runAction('connect', server),
							onDisconnect: () => runAction('disconnect', server),
							onRemove: () => runAction('remove', server),
						}),
					),
				),
				h(AppMcpCreator, {
					t,
					onCreated: (server) => {
						if (server !== null && server !== undefined) setAutoExpandId(String(server.id ?? ''))
						load()
					},
				}),
				h(AddServerForm, { t, busy: addBusy, onAdd: addServer }),
				h(ToolTestBox, { t, servers }),
			)
		}

		/* ------------------------------------------------------------------ *
		 * Block 3: Windows without OS confirmations
		 * ------------------------------------------------------------------ */

		function textValueOf(value) {
			if (typeof value === 'string') return value
			if (typeof value === 'number' && Number.isFinite(value)) return String(value)
			return ''
		}

		function firstBoolean(...values) {
			for (const value of values) if (typeof value === 'boolean') return value
			return undefined
		}

		function firstText(...values) {
			for (const value of values) {
				const text = textValueOf(value)
				if (text !== '') return text
			}
			return ''
		}

		/** Fold the host answer into the shape the Windows block renders (aliases tolerated). */
		function normalizeWindowsStatus(raw) {
			const data = isRecord(raw) ? raw : {}
			const uac = isRecord(data.uac) ? data.uac : {}
			const registry = isRecord(data.uacValues) ? data.uacValues : isRecord(uac.values) ? uac.values : isRecord(data.registry) ? data.registry : {}
			const values = []
			for (const key of Object.keys(registry)) {
				const text = textValueOf(registry[key])
				if (text !== '') values.push({ name: key, value: text })
			}
			const autostart = isRecord(data.autostart) ? data.autostart : isRecord(data.scheduledTask) ? data.scheduledTask : {}
			const accountAdmin = firstBoolean(data.isAdminUser, data.userIsAdmin, data.accountAdmin)
			const elevated = firstBoolean(data.elevated, data.isElevated, data.admin, data.isAdmin, uac.elevated)
			const uacEnabled = firstBoolean(data.uacEnabled, uac.enabled, uac.uacEnabled)
			return {
				isAdminUser: accountAdmin === undefined ? true : accountAdmin,
				elevated: elevated === true,
				uacEnabled: uacEnabled === true,
				uacKnown: uacEnabled !== undefined || values.length > 0,
				uacValues: values,
				taskExists: firstBoolean(autostart.taskExists, autostart.exists, data.autostartTaskExists) === true,
				runLevel: firstText(autostart.runLevel, data.runLevel),
				pendingConsent: firstBoolean(data.pendingConsent, data.consentPending, data.pending) === true,
				log: firstText(data.log, data.lastLog, data.lastSetupLog, data.lastError, data.error, data.message),
			}
		}

		/** Stable comparison value for the real OS state (the pending flag is transient). */
		function windowsSignature(status) {
			return [status.elevated, status.uacEnabled, status.uacKnown, status.taskExists, status.runLevel].join('|')
		}

		/** Whether the normalized status already shows the expected result of an action. */
		function windowsExpectedReached(action, status) {
			if (action === 'enable') return status.uacKnown && status.uacEnabled === false
			if (action === 'disable') return status.uacKnown && status.uacEnabled === true && status.taskExists === false
			return false
		}

		/** True when the answer looks like a Windows status object rather than an ack. */
		function looksLikeWindowsStatus(raw) {
			return (
				isRecord(raw) &&
				['isAdminUser', 'userIsAdmin', 'elevated', 'isElevated', 'admin', 'isAdmin', 'uacEnabled', 'uac', 'autostart', 'scheduledTask', 'pendingConsent'].some(
					(key) => Object.prototype.hasOwnProperty.call(raw, key),
				)
			)
		}

		/**
		 * Block 3: Windows without OS confirmations. The user starts every action; the
		 * block only reads the state, posts the action and polls until Windows reports
		 * the change (the enable path shows exactly one real UAC prompt).
		 */
		function WindowsSection({ t }) {
			const [state, setState] = React.useState({ status: 'loading', windows: null })
			const [error, setError] = React.useState('')
			const [action, setAction] = React.useState('')
			const [pending, setPending] = React.useState(false)
			const [notice, setNotice] = React.useState('')
			const [noticeKind, setNoticeKind] = React.useState('ok')
			const [confirm, setConfirm] = React.useState('')
			const alive = React.useRef(true)
			const cancelled = React.useRef(false)

			React.useEffect(() => {
				alive.current = true
				return () => {
					alive.current = false
					cancelled.current = true
				}
			}, [])

			const load = React.useCallback(() => {
				setState((current) => ({ status: current.windows === null ? 'loading' : current.status, windows: current.windows }))
				fetchWindowsStatus().then(
					(raw) => {
						if (!alive.current) return
						setState({ status: 'ready', windows: normalizeWindowsStatus(raw) })
						setError('')
					},
					(loadFailure) => {
						if (!alive.current) return
						setError(messageOf(loadFailure))
						setState((current) => ({ status: 'error', windows: current.windows }))
					},
				)
			}, [])

			React.useEffect(() => {
				load()
				return undefined
			}, [load])

			/** Poll every 1.5 s until the expected state shows up (or 60 s pass). */
			async function pollChange(targetAction, baseline, deadline) {
				let attempt = 0
				while (alive.current && !cancelled.current && Date.now() < deadline) {
					await delay(1500)
					if (!alive.current || cancelled.current) return
					attempt += 1
					let next = null
					try {
						next = normalizeWindowsStatus(await fetchWindowsStatus())
					} catch (pollError) {
						continue
					}
					if (!alive.current) return
					setState({ status: 'ready', windows: next })
					const changed = windowsSignature(next) !== baseline
					const reached = windowsExpectedReached(targetAction, next)
					if (reached || (changed && next.pendingConsent === false && attempt >= 2)) {
						setPending(false)
						setAction('')
						setNotice(t(targetAction === 'enable' ? 'windowsDoneEnable' : 'windowsDoneDisable'))
						setNoticeKind('ok')
						return
					}
				}
				if (!alive.current) return
				setPending(false)
				setAction('')
				setNotice(t('windowsTimeout'))
				setNoticeKind('err')
			}

			function run(targetAction) {
				if (!WINDOWS_ACTIONS.includes(targetAction) || action !== '' || pending) return
				setConfirm('')
				setError('')
				setNotice('')
				setAction(targetAction)
				if (targetAction !== 'restart') setPending(true)
				const baseline = state.windows === null ? '' : windowsSignature(state.windows)
				postWindowsAction(targetAction).then(
					(raw) => {
						if (!alive.current) return
						if (looksLikeWindowsStatus(raw)) setState({ status: 'ready', windows: normalizeWindowsStatus(raw) })
						if (targetAction === 'restart') {
							setAction('')
							setNotice(t('windowsRestarting'))
							setNoticeKind('ok')
							return
						}
						cancelled.current = false
						void pollChange(targetAction, baseline, Date.now() + 60000)
					},
					(failure) => {
						if (!alive.current) return
						if (targetAction === 'restart' && failure instanceof Error && failure.code === 'network') {
							setAction('')
							setNotice(t('windowsRestarting'))
							setNoticeKind('ok')
							return
						}
						setAction('')
						setPending(false)
						setError(errorText(t, 'windowsActionError', failure))
					},
				)
			}

			const windows = state.windows
			const ready = state.status === 'ready' && windows !== null
			const accountAdmin = windows === null ? true : windows.isAdminUser
			const busy = action !== '' || pending
			const row = (label, badgeText, variant, extra) =>
				h(
					'div',
					{ className: 'su-row', key: label },
					h('span', { className: 'su-meta' }, label),
					h(
						'div',
						{ className: 'su-meta' },
						h('span', { className: 'su-badge' + (variant === 'ok' ? ' su-badgeOk' : variant === 'warn' ? ' su-badgeWarn' : '') }, badgeText),
						extra === undefined || extra === null ? null : extra,
					),
				)
			const confirmRow = (kind, text, yesLabel) =>
				h(
					'span',
					{ className: 'su-confirm' },
					text,
					h('button', { type: 'button', className: 'su-secondary su-danger', onClick: () => run(kind), disabled: busy }, yesLabel),
					h('button', { type: 'button', className: 'su-secondary', onClick: () => setConfirm(''), disabled: busy }, t('windowsCancel')),
				)

			return h(
				'section',
				{ 'aria-label': t('windowsTitle') },
				h(
					'div',
					{ className: 'su-card' },
					h(
						'div',
						{ className: 'su-cardHead' },
						h(
							'div',
							{ className: 'su-cardHeadText' },
							h('h2', { className: 'su-cardTitle' }, t('windowsTitle')),
							h('p', { className: 'su-hint' }, t('windowsExplain')),
						),
						h('button', { type: 'button', className: 'su-secondary', onClick: load, disabled: busy }, state.status === 'loading' ? t('refreshing') : t('refresh')),
					),
					state.status === 'loading' ? h('p', { className: 'su-hint' }, t('loading')) : null,
					state.status === 'error'
						? h(ErrorBanner, { text: t('windowsLoadError', { message: error }), onRetry: load, retryLabel: t('retry') })
						: null,
					ready
						? h(
								'div',
								{ style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
								row(t('windowsAdminLabel'), windows.elevated ? t('windowsYes') : t('windowsNo'), windows.elevated ? 'ok' : 'warn'),
								row(
									t('windowsUacLabel'),
									!windows.uacKnown ? t('windowsUacUnknown') : windows.uacEnabled ? t('windowsUacOn') : t('windowsUacOff'),
									!windows.uacKnown ? '' : windows.uacEnabled ? 'warn' : 'ok',
								),
								windows.uacValues.length === 0
									? null
									: h(
											'div',
											{ className: 'su-meta' },
											h('span', { className: 'su-label' }, t('windowsUacValues')),
											h('span', { className: 'su-code' }, windows.uacValues.map((entry) => entry.name + '=' + entry.value).join(' · ')),
										),
								row(
									t('windowsAutostartLabel'),
									windows.taskExists ? t('windowsTaskYes') : t('windowsTaskNo'),
									windows.taskExists ? 'ok' : '',
									windows.runLevel === '' ? null : h('span', { className: 'su-code' }, t('windowsRunLevel', { value: windows.runLevel })),
								),
								windows.log === ''
									? null
									: h(
											'div',
											{ className: 'su-field' },
											h('span', { className: 'su-label' }, t('windowsLog')),
											h('pre', { className: 'su-result' }, windows.log),
										),
								)
						: null,
					h('p', { className: 'su-warning' }, t('windowsEnableWarning')),
					accountAdmin ? null : h('p', { className: 'su-notice su-err', role: 'alert' }, t('windowsNeedAdmin')),
					pending ? h('p', { className: 'su-hint', role: 'status' }, t('windowsPending')) : null,
					error !== '' && state.status !== 'error' ? h('p', { className: 'su-notice su-err', role: 'alert' }, error) : null,
					notice !== '' ? h('p', { className: 'su-notice ' + (noticeKind === 'err' ? 'su-err' : 'su-ok'), role: 'status' }, notice) : null,
					h(
						'div',
						{ className: 'su-serverActions', style: { flexWrap: 'wrap' } },
						h('button', { type: 'button', className: 'su-primary', onClick: () => run('enable'), disabled: busy || !accountAdmin }, action === 'enable' ? t('windowsEnabling') : t('windowsEnable')),
						confirm === 'disable'
							? confirmRow('disable', t('windowsDisableConfirm'), t('windowsDisableYes'))
							: h('button', { type: 'button', className: 'su-secondary', onClick: () => setConfirm('disable'), disabled: busy || !accountAdmin }, action === 'disable' ? t('windowsDisabling') : t('windowsDisable')),
						confirm === 'restart'
							? confirmRow('restart', t('windowsRestartConfirm'), t('windowsRestartYes'))
							: h('button', { type: 'button', className: 'su-secondary', onClick: () => setConfirm('restart'), disabled: busy || !accountAdmin }, t('windowsRestart')),
					),
				),
			)
		}

		/* ------------------------------------------------------------------ *
		 * Root page
		 * ------------------------------------------------------------------ */

		function SuperuserPage(props) {
			const t = props.t
			const store = props.sessionHint
			const sessionId = useActiveSessionId(props.useSessions, store)
			const [state, setState] = React.useState({ status: 'idle', permission: null })
			const [error, setError] = React.useState('')
			const [tick, setTick] = React.useState(0)
			const [busy, setBusy] = React.useState(false)
			const [toggleError, setToggleError] = React.useState('')
			const alive = React.useRef(true)

			React.useEffect(() => {
				alive.current = true
				return () => {
					alive.current = false
				}
			}, [])

			React.useEffect(() => {
				if (sessionId === null || sessionId === undefined) {
					setState({ status: 'no-session', permission: null, session: null })
					setError('')
					return undefined
				}
				let current = true
				setState((previous) => Object.assign({}, previous, { status: 'loading' }))
				setError('')
				fetchState(sessionId).then(
					(data) => {
						if (!current || !alive.current) return
						const permission = isRecord(data.permission) ? data.permission : null
						setState({ status: 'ready', permission, session: isRecord(data.session) ? data.session : null })
					},
					(loadFailure) => {
						if (!current || !alive.current) return
						setError(messageOf(loadFailure))
						setState({ status: 'error', permission: null, session: null })
					},
				)
				return () => {
					current = false
				}
			}, [sessionId, tick])

			function toggle(nextEnabled) {
				if (sessionId === null || sessionId === undefined || busy) return
				setBusy(true)
				setToggleError('')
				postPermission(sessionId, nextEnabled).then(
					(data) => {
						if (!alive.current) return
						setBusy(false)
						const permission = isRecord(data.permission)
							? data.permission
							: isRecord(state.permission)
								? Object.assign({}, state.permission, { enabled: nextEnabled })
								: null
						setState({ status: 'ready', permission, session: state.session ?? null })
					},
					(switchFailure) => {
						if (!alive.current) return
						setBusy(false)
						setToggleError(messageOf(switchFailure))
					},
				)
			}

			return h(
				'section',
				{ className: 'su-root', 'aria-label': t('title') },
				h('style', null, CSS),
				h(
					'div',
					{ className: 'su-inner' },
					h(
						'header',
						{ className: 'su-head' },
						h('span', { className: 'su-mark' }, h(SuperuserGlyph, { size: 24 })),
						h(
							'div',
							{ className: 'su-headText' },
							h('h1', { className: 'su-title' }, t('title')),
							h('p', { className: 'su-subtitle' }, t('subtitle')),
						),
					),
					h(PermissionCard, {
						t,
						sessionId: sessionId === undefined ? null : sessionId,
						state,
						busy,
						error: toggleError,
						onToggle: toggle,
						onRefresh: () => setTick((value) => value + 1),
					}),
					h(McpSection, { t }),
					h(WindowsSection, { t }),
				),
			)
		}

		/* ------------------------------------------------------------------ *
		 * Session header toggle
		 * ------------------------------------------------------------------ */


		function SuperuserHeaderToggle(props) {
			const t = props.t
			const sessionId = sessionIdOf(props)
			const state = useSessionSuperuser(sessionId, props.sessionHint)
			const ariaLabel =
				sessionId === null ? t('suToggleLoading') : state.status === 'error' ? t('suToggleError') : state.enabled ? t('suToggleAriaOn') : t('suToggleAriaOff')
			return h(
				'button',
				{
					type: 'button',
					className: 'su-headerToggle',
					'data-on': state.enabled ? 'true' : 'false',
					'aria-label': ariaLabel,
					title: ariaLabel,
					onClick: state.toggle,
					disabled: sessionId === null || state.busy || state.status === 'loading' || state.status === 'error',
				},
				h('span', { className: 'su-dot' + (state.status === 'error' ? ' su-dotErr' : state.enabled ? ' su-dotOn' : '') }),
				h('span', null, state.enabled ? t('suToggleOn') : t('suToggleOff')),
			)
		}

		function SuperuserComposerToggle(props) {
			const t = props.t
			const sessionId = sessionIdOf(props)
			const state = useSessionSuperuser(sessionId, props.sessionHint)
			const label = state.busy ? '…' : state.enabled ? t('composerOn') : t('composerOff')
			const ariaLabel =
				sessionId === null ? t('suToggleLoading') : state.status === 'error' ? t('suToggleError') : state.enabled ? t('suToggleAriaOn') : t('suToggleAriaOff')
			return h(
				'button',
				{
					type: 'button',
					className: 'su-composerBtn',
					'data-on': state.enabled ? 'true' : 'false',
					'aria-label': ariaLabel,
					title: ariaLabel,
					onClick: state.toggle,
					disabled: sessionId === null || state.busy || state.status === 'loading' || state.status === 'error',
				},
				h(SuperuserGlyph, { size: 14 }),
				h('span', { className: 'su-composerLabel' }, label),
			)
		}

		/* ------------------------------------------------------------------ *
		 * Plugin entry
		 * ------------------------------------------------------------------ */

		return {
			inject: ['slots', 'locale'],
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, { en: EN }), 'superuser: english dictionary')
				ctx.effect(() => ctx.locale.register(NS, 'ru', RU), 'superuser: russian dictionary')
				ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'superuser: chinese dictionary')
				const t = ctx.locale.bind(NS)
				const sessionHint = createSessionHintStore()

				// The page: a root-scoped keyed `main` entry addressed by the panellist id.
				ctx.effect(
					() =>
						ctx.slots.inject('main', () =>
							ctx.slots.register(
								{
									name: 'main',
									key: PANEL_ID,
									locale: NS,
									inject: () => ({ t, sessionHint }),
								},
								SuperuserPage,
							),
						),
					'superuser: main page',
				)

				// The sidebar glyph: the component itself is the icon.
				ctx.effect(
					() =>
						ctx.slots.inject('sidebar.panellist', () =>
							ctx.slots.register(
								{
									name: 'sidebar.panellist',
									id: PANEL_ID,
									order: PANEL_ORDER,
									locale: NS,
									label: () => t('nav'),
								},
								SidebarIcon,
							),
						),
					'superuser: sidebar entry',
				)

				// The session-scoped toggle: also the source of the page's chat id.
				ctx.effect(
					() =>
						ctx.slots.inject('conversation.session.header.utilities', () =>
							ctx.slots.register(
								{
									name: 'conversation.session.header.utilities',
									id: HEADER_TOGGLE_ID,
									order: HEADER_TOGGLE_ORDER,
									locale: NS,
									inject: () => ({ t, sessionHint }),
								},
								SuperuserHeaderToggle,
							),
						),
					'superuser: chat header toggle',
				)

				// The composer tool-row button: same state path as the header toggle.
				ctx.effect(
					() =>
						ctx.slots.inject('conversation.input.left', () =>
							ctx.slots.register(
								{
									name: 'conversation.input.left',
									id: 'superuser-composer',
									order: 10,
									locale: NS,
									inject: () => ({ t, sessionHint }),
								},
								SuperuserComposerToggle,
							),
						),
					'superuser: composer button',
				)
			},
		}
	},
})
