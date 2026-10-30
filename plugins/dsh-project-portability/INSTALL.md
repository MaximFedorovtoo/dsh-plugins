# Установка dsh-project-portability

## Требования

- DeepSeek Harness **0.2.x** (проверено на 0.2.1-rc.3), профиль `desktop` или любой другой.
- Ни Node.js, ни Python, ни компиляторов не нужно: плагин — чистый JavaScript без зависимостей и без этапа сборки.
- Git не нужен при установке из папки.

## Установка из папки

```powershell
dsh plugin --profile desktop add C:\путь\к\dsh-project-portability
```

или в интерфейсе: **Plugins → Add plugin** → абсолютный путь к папке плагина
(не к родительской папке с другими плагинами).

Плагин добавляется в зависимости профиля и в `dsh.profile.bundles` — то есть
сразу включён. После установки нажмите **Ctrl+R** (или перезапустите DSH).

## Установка из этого репозитория (git)

```powershell
dsh --% plugin --profile desktop add "github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-project-portability"
```

`<commit>` — SHA из [списка коммитов](https://github.com/MaximFedorovtoo/dsh-plugins/commits/main).
Стоп-парсинг `--%` обязателен в PowerShell из-за символа `&` в адресе; для
git-установки на машине должен быть установлен `git`.

## Проверка установки

1. В сайдбаре появилась строка **«Перенос проектов»**.
2. У модели есть инструменты `project_list`, `project_export`, `project_import`.
3. В `%USERPROFILE%\.dsh\profiles\desktop\node_modules` есть junction
   `dsh-project-portability` на папку плагина.

## Обновление

Плагин установлен ссылкой на папку, поэтому обновление = замена файлов в папке
и `Ctrl+R` (для host-части — перезапуск приложения):

```powershell
# просто замените файлы в C:\путь\к\dsh-project-portability
```

Если папка переехала — переустановите:

```powershell
dsh plugin --profile desktop remove dsh-project-portability
dsh plugin --profile desktop add <новая папка>
```

## Удаление

```powershell
dsh plugin --profile desktop remove dsh-project-portability
```

Архивы в `%USERPROFILE%\.dsh\exports` не удаляются — при необходимости удалите их вручную.

## Если что-то не работает

| Симптом | Решение |
|---|---|
| Нет страницы в сайдбаре | `Ctrl+R`; проверьте, что плагин включён в **Plugins → Installed** |
| `project_import` пишет «project directory is missing» | папка проекта перемещена/удалена — укажите другой `targetDir` |
| Импорт отказал «archive format v2 … newer plugin» | архив создан более новой версией плагина — обновите плагин |
| «archive has no manifest.json» | файл повреждён или это не `.dshpack`; проверьте `tar -tzf <файл>` |
| Импорт пишет предупреждения про вложения | часть вложений отсутствовала в локальном хранилище на момент экспорта; чаты при этом переносятся |
