# Supporting Multiple Languages in the Web UI

English | [简体中文](support-multi-language.zh-CN.md)

The firmware uses a client-side i18n approach: all translations are stored
in one JavaScript dictionary embedded in the firmware. No server-side
changes are needed.

## Architecture

All translation logic lives in `html/app/00-i18n.js`:

- A `LANG` object with one sub-object per language (`en`, `zh`)
- Language auto-detection: the `rtl_lang` key in `localStorage` wins
  (written by the language selector in System → Display), then the
  browser's `navigator.languages` are matched exactly and by prefix,
  then English
- `t(key, vars)` looks up a translated string; `{name}` placeholders in
  the string are replaced from `vars`, e.g. `t("v_del_q", {n: vid})`
- `i18nApply()` applies the dictionary to the static markup once at load

Translation keys are flat strings. The English entry is the fallback when
a key is missing in another language, and the key itself is the fallback
when it is missing everywhere. The host tests assert that the `en` and
`zh` key sets stay identical.

Changing the language stores the choice and reloads the page, so every
dynamically built table is rebuilt in the new language.

`login.html` is served before authentication and does not load `app.js`;
it carries its own five strings per language in an inline table and
repeats the same detection rule.

## How to Add a New Language

### 1. Add a dictionary entry in `html/app/00-i18n.js`

Append a sub-object to `LANG`. Every key from `LANG.en` should be present:

```js
var LANG={
en:{
nav_dash:"Dashboard",
...
},
LANGCODE:{            // add your language here
nav_dash:"...",
...
}
};
```

### 2. Add the language to the selector in `html/index.html`

```html
<select class="in" id="langSel">
  <option value="en">English</option>
  <option value="zh">中文</option>
  <option value="LANGCODE">Native name</option>
</select>
```

### 3. Add the login strings in `html/login.html`

The inline table there holds, per language: page title, subtitle,
password label, button label, wrong-password message.

### 4. Verify auto-detection

The detection walks `navigator.languages` (falling back to
`navigator.language`) and picks the first entry that matches a `LANG`
key exactly or by its `xx-YY` prefix, otherwise English.

## Two Translation Mechanisms

### (A) `data-i18n` attributes (declarative, for HTML)

```html
<h2 data-i18n="pt_title">Port configuration</h2>
<button class="ctl" data-i18n="c_apply" data-i18n-t="sy_dhcp_t">Apply</button>
<input class="in" data-i18n-p="l2_filter">
```

- `data-i18n` sets the element's text content
- `data-i18n-t` sets the `title` attribute (tooltip)
- `data-i18n-p` sets the `placeholder` attribute

The English text stays in the markup as the fallback and as the source
of truth for what the key means.

### (B) `t("key")` calls (imperative, for JavaScript)

```js
tr.insertCell().textContent=t("c_port")+" "+p;
toast(t("v_loaded",{n:vid}),"ok");
```

Strings that are identical in every language (`10M`, `2.5G`, `MAC`,
`VLAN`, `CPU`, `RSTP`) are literals, not dictionary entries.

## Size Considerations

- Each language adds roughly 12 KB to `app.js` before compression; the
  build gzips the file, so the flash cost of a language is closer to 3 KB
- The largest embedded file must stay below 64 KB after compression
  (`uint16_t` length in the file table); `app.js` with two languages
  is about 30 KB compressed — see `webui-compression.md` for the budget

## Build

No special flags are needed. `html/` is minified and embedded by the
normal build (see `webui-compression.md`).
