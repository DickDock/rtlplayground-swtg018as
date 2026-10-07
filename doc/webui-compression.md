# Compressing the Web UI Assets

English | [简体中文](webui-compression.zh-CN.md)

The Web UI (all files under `html/`) is embedded into the flash image and
served over HTTP.  Two build-time steps keep it small: a safe minifier and
gzip compression of the embedded files.

## How it works

```
html/index.html html/login.html html/favicon.ico --\
                                                    +--(minify.py)-->  output/html_min/  --(fileadder -z)-->  flash image
html/app/*.js --(concatenate in filename order)----/
```

- `tools/minify.py` removes comments (`<!-- -->`, `//`, `/* */`) and
  line-leading whitespace without touching string or regex literals, so
  the output is functionally identical to the input.  Binary files
  (`.ico`) are copied through unchanged.  The raw sources in `html/` stay
  untouched for development; the minified copy in `output/` is a pure
  build artifact.
- The authored JavaScript lives in `html/app/*.js`, one file per concern
  (`00-i18n.js` for the dictionaries, `01-core.js` for the shared
  helpers, `02-config.js` for the CLI grammar, one file per tab).  The
  `html_min` target concatenates them in filename order and minifies the
  result as a single `app.js`, so the browser fetches one script and gzip
  can compress across all of it.  The host tests evaluate the part files
  directly, which is why the core files must not touch the DOM at top
  level (see the comment header of `01-core.js`).
- The Web UI is a single-page application: `index.html` holds all seven
  pages as sections (`#dash`, `#ports`, `#vlan`, `#l2`, `#links`,
  `#flows`, `#system`) that the sidebar switches between via the URL
  hash; the pre-merge hashes (`#stp`, `#lag`, `#eee`, `#stats`, `#bw`,
  `#mirror`, `#fw`) are mapped onto the new ones at boot.  `login.html`
  stays separate because it is the authentication gate and is
  self-contained (its own styles and strings), so nothing else is served
  before login.  Only these two pages plus `app.js` and the favicon are
  embedded; the stylesheet and the theme bootstrap are inline in
  `index.html`.
- A section starts its pollers when it is shown and stops them when it is
  left; re-entering a section refetches the data.
- `fileadder -z` gzip-compresses every file (zlib, gzip format,
  `Z_BEST_COMPRESSION`) when it generates the file table
  (`html_data.c`/`html_data.h`) and when it embeds the files into the
  final image.  Both invocations run on `output/html_min/`, so the table
  and the image always agree.
- The httpd serves each file with `Content-Encoding: gzip` according to
  the `gzip` flag in its `f_data` entry.  The 8051 only copies compressed
  bytes from flash to the socket; decompression happens in the browser.
- Only the static files are compressed.  The JSON API responses
  (`/information.json`, `/vlanlist`, ...) are generated on the fly and
  stay uncompressed.

## Measured effect

Build on any machine (the Web UI is machine-independent):

| | raw | minified | gzip (flash + wire) |
|---|---:|---:|---:|
| `app.js` (two languages included) | 104,464 | 94,434 | 30,781 |
| `index.html` | 38,029 | 34,735 | 9,170 |
| `login.html` | 5,403 | 5,109 | 2,374 |
| `favicon.ico` | 378 | 378 | 214 |
| total | 148,274 | 134,656 | 42,539 (28.7 %) |

Sizes move with the UI itself; the number to watch is the gzip total.
The HTML slot is the 64 KB sector-aligned window at `HTML_LOCATION`
0xB0000, and each single file must stay below the `uint16_t` size
limit of the file table, i.e. 64 KB gzip.  Treat ~40 KB gzip for the
whole slot as the point where trimming is due.

## Notes

- `fileadder` terminates the embedded files with a NUL directly after the
  content (previously at `data_read + 1`), so the `strlen()`-based size
  computation no longer depends on uninitialised buffer content.
- `version.h` is now written by a single atomic `printf` (change from
  upstream) instead of five separate `echo`s, so a parallel build
  (`make -j`) can no longer read a half-written copy.  It stays in
  `.PHONY` so it is regenerated on every build.

## Verification

Decompress what the firmware embeds and compare it with the minified
sources:

```python
import gzip, re
h = open('html_data.h').read(); c = open('html_data.c').read()
starts = dict((k, int(v, 16)) for k, v in
              re.findall(r'#define FDATA_START_(\w+) 0x([0-9a-f]+)', h))
sizes = dict((k, int(v)) for k, v in
             re.findall(r'#define FDATA_SIZE_(\w+) (\d+)', h))
entries = [(p, sizes[z], starts[s]) for p, s, z in
           re.findall(r'\{"/([^"]+)", FDATA_START_(\w+), '
                      r'FDATA_SIZE_(\w+), \w+, 1\}', c)]
d = open('output/rtlplayground.bin', 'rb').read()
for name, size, start in entries:
    assert gzip.decompress(d[start:start+size]) == \
        open('output/html_min/' + name, 'rb').read()
```

`tools/httpd_sim output/html_min` serves the minified files over plain
HTTP for local UI work (it does not exercise the gzip path); a browser
session against a flashed switch (or `curl --compressed`) is the final
check.
