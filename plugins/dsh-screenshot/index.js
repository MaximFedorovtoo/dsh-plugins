/**
 * Host half of the screenshot bundle.
 *
 * Two model-facing tools and one prompt section:
 *
 * - `screenshot` captures the current desktop screen (all monitors) or the
 *   image currently on the Windows clipboard and hands it to the model as a
 *   real image block, so "look at my screen / look at the screenshot I just
 *   snipped" needs no file juggling.
 * - `zoom_image` crops a region of any image file and upscales it, which is
 *   how a downscaled screenshot's small labels, values and annotations become
 *   readable.
 * - The prompt section teaches the model how to read a screenshot that the
 *   user attached in the composer: the typed text is the task statement, the
 *   marks are the emphasis, the image is the evidence.
 *
 * Captures are taken through Windows PowerShell (`System.Drawing`) because the
 * Harness host runs as plain Node (`ELECTRON_RUN_AS_NODE`), where no Electron
 * capture API exists.
 */

import { execFile } from 'node:child_process';
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';

export const name = 'screenshot';

/** Services the Host half registers against; both rows always exist. */
export const inject = ['tools', 'systemPrompt'];

/** Prompt placement: after the shipped tool sections, before the SDK block. */
const SECTION_ORDER = 3050;

/**
 * Model-facing reading protocol for screenshots. Kept short on purpose: it is
 * appended to every request, so it has to earn its tokens.
 */
const SCREENSHOT_SECTION = `## Reading screenshots

A user message may include images — screenshots of an application, a page, a terminal, an editor, or a photo of a screen. The text the user typed around the image is the task statement; the image is evidence for that text, not a replacement for it.

- Before acting, say briefly what the image shows: application/window, screen or dialog, the specific control, value or error that is visible. Do not invent interface details the image does not show.
- Treat every mark the user added — arrows, circles, boxes, underlines, crosses, handwriting, numbers, colored highlights — as explicit emphasis. Resolve each mark to a concrete element visible in the image (a button, a field, a line of text, a value, a region) and address exactly that element. When there are several marks, cover all of them and name them in order.
- Screenshots arrive downscaled; do not guess small text. Call \`zoom_image\` on the marked region (scale 3-4 for dense UI) to read labels, values, icons and status bars, then base the fix on what you actually read. Use \`read_image\` for image files already in the workspace.
- When the user pasted a screenshot and you need its full-resolution copy, call \`screenshot\` with \`source: "clipboard"\` — the clipboard normally still holds that bitmap right after pasting — then zoom the returned file path. Windows WebP copies are decoded automatically.
- Map the marked element to the code that renders it: search for its visible text, error string, id, class, route or data field. If nothing matches plausibly, say what you could not find instead of editing something that merely looks similar.
- If a mark or the accompanying text is ambiguous in a way that would change the fix, ask one precise question about that element; do not ask the user to re-explain the whole screenshot.
- Verify the change against the same evidence: build, test, or re-render, and state what should now be visible where the mark pointed.
- The user may also ask you to look at the screen directly: \`screenshot\` returns a fresh image of the desktop or of the clipboard image.`;

/** Windows PowerShell 5.1 — present on every supported Windows install. */
const POWERSHELL = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

/** `'…'` PowerShell literal; embedded quotes are doubled. */
function psQuote(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

/** Attachment value schema shared by both image tools. */
const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height'],
      properties: {
        width: { type: 'integer' },
        height: { type: 'integer' },
      },
    },
  },
};

/** Render one image outcome as its text envelope plus the image block. */
function imageContent(text, image) {
  return [
    { type: 'text', text },
    {
      type: 'image',
      attachment: {
        attachmentId: image.attachmentId,
        mediaType: image.mediaType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        ...(image.name === undefined ? {} : { name: image.name }),
        ...(image.originalDimensions === undefined
          ? {}
          : { originalDimensions: { ...image.originalDimensions } }),
      },
    },
  ];
}

/** Copy the attachment-service metadata field by field. */
function imageValueOf(ref) {
  return {
    attachmentId: ref.attachmentId,
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...(ref.name === undefined ? {} : { name: ref.name }),
    ...(ref.originalDimensions === undefined
      ? {}
      : { originalDimensions: { ...ref.originalDimensions } }),
  };
}

/**
 * Capture the virtual screen or the clipboard image to `outPath`.
 *
 * The snippet never throws: every failure is reported as `{ error }` on
 * stdout, so the Node side owns the user-facing wording and PowerShell's
 * CLIXML error stream cannot leak into a tool result.
 */
function captureScript(source, outPath) {
  const head = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
Add-Type -AssemblyName System.Drawing
`;
  const tail = `} catch {
  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;
  if (source === 'clipboard') {
    return `${head}Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $img) { throw 'CLIPBOARD_NO_IMAGE' }
$w = $img.Width
$h = $img.Height
$img.Save(${psQuote(outPath)}, [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
@{ width = $w; height = $h } | ConvertTo-Json -Compress
${tail}`;
  }
  return `${head}Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DshDpiAwake { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }' -ErrorAction SilentlyContinue
try { [DshDpiAwake]::SetProcessDPIAware() | Out-Null } catch { }
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = [System.Drawing.Bitmap]::new($b.Width, $b.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$g.Dispose()
$w = $bmp.Width
$h = $bmp.Height
$bmp.Save(${psQuote(outPath)}, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
@{ width = $w; height = $h; left = $b.Left; top = $b.Top } | ConvertTo-Json -Compress
${tail}`;
}

/** Crop `x,y,width,height` of `inPath`, scale it, save as `outPath`. */
function cropScript(inPath, outPath, x, y, width, height, scale) {
  const int = (value) => String(Math.max(0, Math.round(Number(value) || 0)));
  return `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile(${psQuote(inPath)})
try {
  $sw = $src.Width
  $sh = $src.Height
  $x = ${int(x)}
  $y = ${int(y)}
  $w = ${int(width)}
  $h = ${int(height)}
  if ($x -ge $sw -or $y -ge $sh -or $w -lt 1 -or $h -lt 1) { throw 'CROP_OUTSIDE_IMAGE' }
  if ($x + $w -gt $sw) { $w = $sw - $x }
  if ($y + $h -gt $sh) { $h = $sh - $y }
  $ow = [int]($w * ${int(scale)})
  $oh = [int]($h * ${int(scale)})
  $rect = [System.Drawing.Rectangle]::new($x, $y, $w, $h)
  $dst = [System.Drawing.Rectangle]::new(0, 0, $ow, $oh)
  $out = [System.Drawing.Bitmap]::new($ow, $oh)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, $dst, $rect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $out.Save(${psQuote(outPath)}, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  @{ width = $ow; height = $oh; sourceWidth = $sw; sourceHeight = $sh } | ConvertTo-Json -Compress
} finally {
  $src.Dispose()
}
} catch {
  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;
}

/**
 * Decode any WIC-supported image (WebP and friends) into an ordinary PNG so
 * the GDI+ crop path can work on it. GDI+ alone cannot open WebP, which is the
 * format the attachment store normalizes screenshots to.
 */
function convertScript(inPath, outPath) {
  return `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$stream = [System.IO.File]::OpenRead(${psQuote(inPath)})
try {
  $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($stream, [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
  $frame = [System.Windows.Media.Imaging.FormatConvertedBitmap]::new($decoder.Frames[0], [System.Windows.Media.PixelFormats]::Bgra32, $null, 0)
  $encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
  $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($frame))
  $out = [System.IO.File]::Create(${psQuote(outPath)})
  try { $encoder.Save($out) } finally { $out.Dispose() }
  @{ width = $frame.PixelWidth; height = $frame.PixelHeight } | ConvertTo-Json -Compress
} finally {
  $stream.Dispose()
}
} catch {
  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;
}

/** Byte signature check for the formats the GDI+ crop path opens directly. */
function gdiSafeImage(data) {
  if (isPng(data)) return true;
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return true;
  const ascii = (offset, text) => {
    if (data.length < offset + text.length) return false;
    for (let index = 0; index < text.length; index += 1) {
      if (data[offset + index] !== text.charCodeAt(index)) return false;
    }
    return true;
  };
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return true;
  return ascii(0, 'BM');
}

/** Read the first bytes of a file, enough to identify its image format. */
async function readImageHead(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Turn one PowerShell `{ error }` record into a model-facing refusal.
 * @param record - parsed metadata containing the reported message.
 * @param context - "capture" or "zoom", for the fallback wording.
 */
function powerShellFailure(record, context) {
  const message = String(record.error);
  if (message.includes('CLIPBOARD_NO_IMAGE')) {
    return new Error(
      'the clipboard holds no image: copy a screenshot first (Win+Shift+S copies it), or attach the image in the composer',
    );
  }
  if (message.includes('CROP_OUTSIDE_IMAGE')) {
    return new Error(
      'the requested region starts outside the image; check x/y/width/height against the image size',
    );
  }
  if (context === 'convert') {
    return new Error(`cannot decode this image format on this machine: ${message}`);
  }
  return new Error(
    context === 'zoom'
      ? `image zoom failed: ${message}`
      : `screen capture failed: ${message}`,
  );
}

/** True when the bytes start with the PNG signature. */
function isPng(data) {
  return (
    data.length > 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  );
}

/** One model-facing envelope for a fresh capture. */
function captureEnvelope(path, meta, source) {
  const where =
    source === 'clipboard'
      ? 'windows clipboard image'
      : `desktop screen capture${meta.left !== undefined ? ` (virtual screen origin ${meta.left},${meta.top})` : ''}`;
  return `<path>${path}</path>
<type>image</type>
<content>
${where}, ${meta.width}x${meta.height} px
</content>`;
}

/** One model-facing envelope for a zoomed crop. */
function zoomEnvelope(path, region, meta) {
  const { x, y, scale } = region;
  return `<path>${path}</path>
<type>image</type>
<content>
crop of ${meta.width}x${meta.height} px source at x=${x}, y=${y}, ${region.width}x${region.height} px, scaled x${scale}
</content>`;
}

/**
 * Attach the host half to the profile composition.
 * @param ctx - plugin context (profile root).
 * @param config - row configuration from `cordis.patch.yml`.
 */
export function apply(ctx, config = {}) {
  const cacheDir =
    typeof config.cacheDir === 'string' && config.cacheDir.trim() !== ''
      ? config.cacheDir
      : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cache', 'screenshot');
  const defaultZoomScale = clampScale(config.defaultZoomScale, 2, 4);
  const maxZoomScale = clampScale(config.maxZoomScale, 4, 8);

  /** Run one PowerShell snippet and return its trimmed stdout. */
  const runPowerShell = (script, signal) =>
    new Promise((resolvePromise, rejectPromise) => {
      // -EncodedCommand keeps the script verbatim: no native argument quoting
      // can strip the C# and path literals inside it.
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      execFile(
        POWERSHELL,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded],
        { windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024, signal },
        (error, stdout, stderr) => {
          if (error === null) {
            resolvePromise(String(stdout).trim());
            return;
          }
          const detail = String(stderr ?? '').trim() || String(stdout ?? '').trim();
          const message =
            error.code === 'ENOENT'
              ? `Windows PowerShell is unavailable at ${POWERSHELL}; screen capture needs it`
              : detail !== ''
                ? detail.split(/\r?\n/u).filter(Boolean).slice(-3).join(' | ')
                : String(error.message);
          rejectPromise(new Error(message));
        },
      );
    });

  /** Parse the JSON line PowerShell printed; tolerate extra output lines. */
  const parseMeta = (stdout) => {
    const line = String(stdout)
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith('{'))
      .pop();
    if (line === undefined) throw new Error('screen capture produced no metadata');
    return JSON.parse(line);
  };

  /** Screenshot/zoom tools need an image-capable route, like `read_image`. */
  const assertImageRoute = async (exec) => {
    const routed = exec.agent?.session?.requestHeader?.()?.config;
    const provider = routed?.provider ?? exec.agent?.options?.provider;
    const model = routed?.model ?? exec.agent?.options?.model;
    const llm = ctx.get('llm');
    if (provider === undefined || model === undefined || llm === undefined) return;
    let active;
    try {
      active = await llm.resolveModelInfo(provider, model, exec.signal);
    } catch {
      return;
    }
    if (active?.inputModalities !== undefined && !active.inputModalities.includes('image')) {
      throw new Error(
        `model "${model}" does not declare image input; switch to an image-capable model to look at screenshots`,
      );
    }
  };

  /** Save PNG bytes into the immutable attachment store. */
  const savePng = async (path) => {
    const attachments = ctx.get('attachments');
    if (attachments === undefined) throw new Error('no attachment service is mounted in this profile');
    const data = await readFile(path);
    if (!isPng(data)) throw new Error(`capture at "${path}" is not a PNG; screen capture failed`);
    const ref = await attachments.saveImage({ data, mediaType: 'image/png', name: basename(path) });
    return imageValueOf(ref);
  };

  /** Parse one PowerShell JSON record and convert its `error` into a refusal. */
  const runJson = async (script, signal, context) => {
    const record = parseMeta(await runPowerShell(script, signal));
    if (typeof record.error === 'string') throw powerShellFailure(record, context);
    return record;
  };

  const stamp = () => new Date().toISOString().replace(/[:.]/gu, '-');

  ctx.effect(
    () => {
      ctx.systemPrompt.section({
        name: 'screenshot:reading',
        order: SECTION_ORDER,
        text: SCREENSHOT_SECTION,
      });
    },
    'screenshot: prompt section',
  );

  ctx.effect(
    () => {
      ctx.tools.register({
        name: 'screenshot',
        description:
          'Capture the desktop screen (all monitors) or the image on the clipboard and return it as an image. Use it when the user says "look at my screen" or asks about a screenshot they just took.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: {
              type: 'string',
              enum: ['screen', 'clipboard'],
              description:
                'screen captures the desktop; clipboard returns the image currently on the clipboard (e.g. right after Win+Shift+S).',
            },
            region: {
              type: 'object',
              additionalProperties: false,
              required: ['x', 'y', 'width', 'height'],
              description: 'Optional crop of the captured image, in captured-image pixels.',
              properties: {
                x: { type: 'integer' },
                y: { type: 'integer' },
                width: { type: 'integer' },
                height: { type: 'integer' },
              },
            },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'image'],
            properties: {
              path: { type: 'string' },
              image: IMAGE_VALUE_SCHEMA,
            },
          },
          render: (args, value) => {
            const source = args.source === 'clipboard' ? 'clipboard' : 'screen';
            return imageContent(captureEnvelope(value.path, value.image, source), value.image);
          },
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          await assertImageRoute(exec);
          await mkdir(cacheDir, { recursive: true });
          const source = args.source === 'clipboard' ? 'clipboard' : 'screen';
          const id = stamp();
          const rawPath = join(cacheDir, `capture-${source}-${id}.png`);
          await runJson(captureScript(source, rawPath), exec.signal, 'capture');
          let finalPath = rawPath;
          if (args.region !== undefined) {
            const region = normalizeRegion(args.region);
            const cropped = join(cacheDir, `capture-${source}-${id}-crop.png`);
            await runJson(
              cropScript(rawPath, cropped, region.x, region.y, region.width, region.height, 1),
              exec.signal,
              'capture',
            );
            finalPath = cropped;
          }
          const image = await savePng(finalPath);
          return { path: finalPath, image };
        },
      });
    },
    'screenshot: tool',
  );

  ctx.effect(
    () => {
      ctx.tools.register({
        name: 'zoom_image',
        description:
          'Crop a region of an image file and upscale it, then return the zoomed image. Use it to read small text, labels or annotations in a downscaled screenshot before deciding a fix.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['file_path', 'region'],
          properties: {
            file_path: {
              type: 'string',
              description: 'PNG/JPEG/GIF file path; relative paths resolve against the session working directory.',
            },
            region: {
              type: 'object',
              additionalProperties: false,
              required: ['x', 'y', 'width', 'height'],
              description: 'Crop rectangle in original image pixels.',
              properties: {
                x: { type: 'integer' },
                y: { type: 'integer' },
                width: { type: 'integer' },
                height: { type: 'integer' },
              },
            },
            scale: {
              type: 'integer',
              description: `Upscale factor (1-${maxZoomScale}), default ${defaultZoomScale}.`,
            },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'source', 'image'],
            properties: {
              path: { type: 'string' },
              source: {
                type: 'object',
                additionalProperties: false,
                required: ['width', 'height'],
                properties: {
                  width: { type: 'integer' },
                  height: { type: 'integer' },
                },
              },
              image: IMAGE_VALUE_SCHEMA,
            },
          },
          render: (args, value) => {
            const region = normalizeRegion(args.region);
            const scale = clampScale(args.scale, defaultZoomScale, maxZoomScale);
            return imageContent(zoomEnvelope(value.path, { ...region, scale }, value.source), value.image);
          },
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          await assertImageRoute(exec);
          const region = normalizeRegion(args.region);
          const scale = clampScale(args.scale, defaultZoomScale, maxZoomScale);
          const path = await resolveImagePath(ctx, exec, args.file_path);
          try {
            await stat(path);
          } catch {
            throw new Error(`image file "${path}" does not exist`);
          }
          await mkdir(cacheDir, { recursive: true });
          // WebP (and anything else GDI+ cannot open) is decoded through WIC
          // into a temporary PNG first; the crop then stays one code path.
          let cropSource = path;
          if (!gdiSafeImage(await readImageHead(path))) {
            const converted = join(cacheDir, `zoom-src-${stamp()}.png`);
            await runJson(convertScript(path, converted), exec.signal, 'convert');
            cropSource = converted;
          }
          const outPath = join(cacheDir, `zoom-${stamp()}.png`);
          const meta = await runJson(
            cropScript(cropSource, outPath, region.x, region.y, region.width, region.height, scale),
            exec.signal,
            'zoom',
          );
          const image = await savePng(outPath);
          return {
            path: outPath,
            source: { width: meta.sourceWidth, height: meta.sourceHeight },
            image,
          };
        },
      });
    },
    'screenshot: zoom tool',
  );
}

/** Coerce one region argument into positive integers. */
function normalizeRegion(region) {
  if (region === undefined) throw new Error('region is required');
  return {
    x: Math.max(0, Math.round(Number(region.x) || 0)),
    y: Math.max(0, Math.round(Number(region.y) || 0)),
    width: Math.max(1, Math.round(Number(region.width) || 1)),
    height: Math.max(1, Math.round(Number(region.height) || 1)),
  };
}

/** Clamp a configured or requested scale factor. */
function clampScale(value, fallback, ceiling) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(ceiling, Math.max(1, Math.round(number)));
}

/** Resolve a model-supplied image path against the session working directory. */
async function resolveImagePath(ctx, exec, filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('file_path must be a non-empty string');
  }
  if (isAbsolute(filePath)) return filePath;
  let base;
  try {
    const session = exec.agent?.session;
    const directory = ctx.get('workingDirectory');
    base = session === undefined ? undefined : directory?.get(session);
  } catch {
    base = undefined;
  }
  return resolve(base ?? process.cwd(), filePath);
}
