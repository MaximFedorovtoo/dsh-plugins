# Установка русской локализации DeepSeek Harness

Пакет `dsh-locale-ru` — клиентский плагин DSH. Он не изменяет установленное приложение: файлы попадают в профиль (`~/.dsh/profiles/<профиль>`, на Windows `%USERPROFILE%\.dsh\profiles\<профиль>`), а словари регистрируются через публичный API `ctx.locale`.

**Требования:** DSH 0.2.x (Web/Desktop-поверхность). Для git-способа нужен `git`; для установщика `.cmd` — только Windows. Пакет без зависимостей и без скриптов сборки.

Ниже четыре способа. **Выберите ровно один.** Если локаль уже стояла другим способом, сначала удалите её (см. [«Смена способа установки»](#смена-способа-установки)).

---

## 1. Discover (индекс плагинов)

1. **Plugins → Experimental plugins** → включите **Custom plugin indexes** — появится вкладка **Discover**.
2. **Discover → Add index source** → вставьте:

   ```
   https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
   ```

3. Найдите карточку **Russian Language Pack** → **Install** → подтвердите версию и источник → **Enable now**.
4. Перезапустите DSH или нажмите Ctrl+R. Язык: **Настройки → Общие → Язык → «Русский»** (если не выбрался сам).

Индекс открыт для проверки: [index.json](https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json).

---

## 2. Git (любая ОС)

Нужен `git`:

- **Windows:** [Git for Windows](https://git-scm.com/download/win) (`winget install --id Git.Git -e`).
- **macOS:** `xcode-select --install` или `brew install git`.
- **Linux:** `sudo apt install git` / `sudo dnf install git`.

SHA коммита — на [странице коммитов](https://github.com/MaximFedorovtoo/dsh-plugins/commits/main).

**Из интерфейса:** **Plugins → Add plugin → Install a third-party plugin** → вставьте:

```
github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-locale-ru
```

**Из CLI:**

```sh
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-locale-ru'
dsh --profile desktop
```

**Важно для Windows и PowerShell.** В адресе появились подкаталог и символ `&`. Обёртка `dsh` — это `.cmd`-файл, и PowerShell передаёт такой аргумент через `cmd`, который обрезает всё после `&`; pnpm получает адрес без `path:` и падает с `ERR_PNPM_INVALID_DEPENDENCY_NAME`. Рабочие варианты:

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-locale-ru"
```

В `cmd.exe` достаточно обычных кавычек. Проверить слой без запуска:

```sh
dsh --profile desktop --dump-config | grep locale-ru
```

На Windows: `dsh --profile desktop --dump-config | Select-String locale-ru`.

---

## 3. Установщик для Windows (без git)

Папка `windows-installer/` — самостоятельный установщик: копирует пакет в `<профиль>\plugins\dsh-locale-ru` и добавляет строку в `cordis.patch.yml` профиля. Ни сети, ни прав администратора, ни Node.js не нужно; код скриптов открыт и читается блокнотом.

1. Скачайте репозиторий (Code → Download ZIP) и распакуйте **целиком**.
2. Если ZIP скачан из интернета: правый клик по ZIP → Свойства → **Разблокировать** → ОК.
3. Двойной клик по `windows-installer\Install-DSH-Russian.cmd`, дождитесь `Done`.
4. Перезапустите DSH или нажмите Ctrl+R. Язык: **Настройки → Общие → Язык → «Русский»**.

Скрипт идемпотентен: повторный запуск обновляет файлы пакета и не добавляет вторую строку. Резервная копия `cordis.patch.yml` создаётся рядом с файлом.

Удаление: `windows-installer\Uninstall-DSH-Russian.cmd` — убирает папку и строку из патча (с резервной копией).

---

## 4. Локальная папка

**Plugins → Add plugin** → абсолютный путь к **папке плагина** `plugins\dsh-locale-ru` в распакованном репозитории (там, где лежит `package.json`):

```
C:\Users\Имя\dsh-plugins\plugins\dsh-locale-ru
/Users/имя/dsh-plugins/plugins/dsh-locale-ru
```

Из CLI: `dsh plugin --profile desktop add ./dsh-plugins/plugins/dsh-locale-ru`.

Папку нельзя перемещать после установки: pnpm оставляет на неё ссылку.

---

## Смена способа установки

DSH отвергает два одновременных подключения одного и того же клиентского модуля (конфликт источников), поэтому переход между способами делается в два шага:

- **Было через `.cmd`, ставите через Plugins/Discover:** сначала `windows-installer\Uninstall-DSH-Russian.cmd`, затем установка из Plugins.
- **Было через Plugins/Discover, хотите `.cmd`:** сначала **Remove** на карточке плагина (или `dsh plugin --profile desktop remove dsh-locale-ru`), затем установщик.

Проверить, что осталась ровно одна строка `locale-ru`:

```powershell
Select-String -Path "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" -Pattern 'locale-ru'
```

---

## Проверка, что работает

1. После перезапуска интерфейс по-русски: «Новая сессия», «Плагины», «Рабочие области».
2. Настройки → Общие → Язык: выбран «Русский».
3. Названия плагинов в Settings → Plugins тоже по-русски.

Если интерфейс остался английским: Ctrl+R; проверьте, что в `cordis.patch.yml` профиля есть строка `locale-ru` и папка `plugins\dsh-locale-ru` существует; посмотрите лог DSH на ошибки загрузки клиентского модуля.

---

## Ограничения

- Нативные меню Electron, приветственное окно и диалоги обновления остаются на английском/китайском: они внутри приложения и не поддерживают смену языка.
- Новые строки DSH, появившиеся после 0.2.1-rc.3, будут на английском — интерфейс не ломается.
- Ответы модели, заголовки сессий и технические идентификаторы не переводятся.

---

## Если не работает

| Симптом | Причина и решение |
|---|---|
| Языка «Русский» нет в списке | Плагин не загрузился: нет строки `locale-ru` в `cordis.patch.yml` или нет папки `plugins\dsh-locale-ru`. Установите заново одним способом. |
| Интерфейс остался английским после установки | Профиль не перезагрузился: Ctrl+R или перезапуск DSH. Проверьте, что язык выбран в настройках. |
| В логе ошибка про конфликт источника/дубликат | Локаль подключена дважды (например, `.cmd` + Plugins). Удалите одну установку (см. «Смена способа установки»). |
| `Plugin is incompatible with dsh ...` | Версия DSH вне `engines.dsh` (`>=0.2.0 <0.3.0`). Обновите пакет или разрешите ровно эту версию: `dsh plugin --profile <профиль> allow-version dsh-locale-ru@0.1.0 --dsh-version <точная версия DSH> --accept-risk`. |
| Установщик пишет «DSH home not found» | DSH ни разу не запускался: запустите приложение один раз, закройте и повторите. При нестандартном `DSH_HOME` переменная учитывается автоматически. |
| Установщик пишет «plugin folder is missing» | Архив распакован не целиком: папки `windows-installer` и `lib` должны лежать рядом с `Install-DSH-Russian.cmd`. |

---

## Что появится в профиле

- `plugins\dsh-locale-ru\` — `package.json`, `lib\index.js`, `lib\client.js`.
- В `cordis.patch.yml` — строка:

  ```yaml
  - insert:
      - id: locale-ru
        name: ./plugins/dsh-locale-ru/lib/index.js
  ```

  (при установке через Plugins/Discover строка будет ссылаться на имя пакета `dsh-locale-ru` — это тоже нормально.)

Пакет не хранит данных; удаление ничего не теряет.
