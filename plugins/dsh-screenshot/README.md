# Screenshot Input (`dsh-screenshot`)

Makes a screenshot a normal part of a conversation: the user stages it in the
composer, the model reads it, and the model can also look at the screen or the
clipboard itself.

## What it adds

| Surface | Behaviour |
|---|---|
| Composer tool row | One camera button. Reads an image from the clipboard (the result of Win+Shift+S or any "copy image"); if the clipboard holds no image it opens the composer's own file picker. The image becomes a normal draft attachment, so the existing preview, admission and send path apply. Ctrl+V and drag-and-drop keep working unchanged. |
| Draft-attachment rail | Replaces the shipped presentation. Clicking an attached image opens an annotation editor over it: pen, arrow, rectangle and text, six colors, three line widths, undo and clear. The text box is white with a move strip and a native corner grip: drag the strip to place it, drag the corner to set width and height (the width is the wrap width), while auto-sizing applies until the first manual resize. **Apply** flattens the annotations into a PNG and swaps the draft attachment for it; the prompt is still yours to write. The rail also keeps the drop target alive (document-level drag listeners feeding `onAddFiles`) and shows file upload progress, retry and removal. |
| Agent tool `screenshot` | Captures the desktop (all monitors) or the clipboard image and returns it to the model as a real image block. Optional `region` crop. |
| Agent tool `zoom_image` | Crops a region of any image file and upscales it (default x2, up to x4) so small labels, values and annotations in a downscaled screenshot become readable. WebP input is decoded through Windows Imaging Component. |
| System prompt | A short "Reading screenshots" protocol: restate what the image shows, treat every mark as explicit emphasis, zoom instead of guessing, map the marked element to the code that renders it, ask one precise question when the mark is ambiguous, and verify against the same evidence. |

## Install

Package `dsh-screenshot`, version 1.4.0, DSH 0.2.x. Plain JavaScript, no
dependencies, no build step. Installation methods for Windows, macOS and Linux
are in the repository guide: [INSTALL.en.md](../../INSTALL.en.md) (English) or
[INSTALL.md](../../INSTALL.md) (Russian). The short version:

```sh
dsh plugin --profile desktop add 'github:MaximFedorovtoo/dsh-plugins#<commit>&path:/plugins/dsh-screenshot'
```

or add the repository index to **Plugins → Discover**:

```
https://raw.githubusercontent.com/MaximFedorovtoo/dsh-plugins/main/index.json
```

## Configuration

`cordis.patch.yml` on the inserted row:

```yaml
- id: screenshot
  config:
    cacheDir: ''          # default: <DSH_HOME>/cache/screenshot
    defaultZoomScale: 2
    maxZoomScale: 4
```

## Platform notes

* **Screen and clipboard capture work on Windows only.** Both agent tools
  (`screenshot` and `zoom_image`) go through Windows PowerShell 5.1 and
  `System.Drawing`/WPF, because the Harness host runs as plain Node, where no
  Electron capture API exists. On macOS and Linux the tools report an explicit
  error; the composer button, the annotation editor, attachments, drag-and-drop
  and paste keep working.
* `zoom_image` decodes through GDI+, so PNG/JPEG/GIF/WebP are supported on
  Windows (WebP and other WIC formats are converted to PNG first).
* The camera button reads the clipboard through the browser Clipboard API, so
  the page needs clipboard-read permission; when the clipboard holds no image it
  falls back to the file picker.
