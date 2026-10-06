# 在 Web UI 中支持多语言

[English](support-multi-language.md) | 简体中文

固件采用客户端 i18n 方案：所有翻译都存储在一个嵌入固件的 JavaScript 字典里。不需要任何服务器端改动。

## 架构

所有翻译逻辑都位于 `html/app.js` 的顶部：

- 一个 `LANG` 对象，每种语言各有一个子对象（`en`、`ja`、`zh`）
- 语言自动检测（依据浏览器语言，可被 `localStorage` 中的 `rtl_lang` 键覆盖，该键由 System 区块中的语言选择器写入）
- `t(key, vars)` 查找翻译后的字符串；字符串中的 `{name}` 占位符会用 `vars` 中的值替换，例如 `t("v_del_q", {n: vid})`
- `i18nApply()` 在页面加载时把字典一次性应用到静态标记上

翻译键是扁平的字符串。当某个键在其他语言中缺失时，以英文条目作为回退；当某个键在所有语言中都缺失时，以键本身作为回退。

切换语言会保存选择并重新加载页面，因此每个动态构建的表格都会以新语言重新生成。

`login.html` 在认证之前就会被提供，并且不加载 `app.js`；它在一张内联表中为每种语言自带那 5 个字符串。

## 如何添加新语言

### 1. 在 `html/app.js` 中添加字典条目

向 `LANG` 追加一个子对象。`LANG.en` 中的每个键都应当存在：

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

### 2. 在 `html/index.html` 的选择器中添加该语言

```html
<select class="ctl" id="langSel" data-i18n-t="sy_lang">
  <option value="en">English</option>
  <option value="ja">日本語</option>
  <option value="zh">中文</option>
  <option value="LANGCODE">Native name</option>
</select>
```

### 3. 在 `html/login.html` 中添加登录字符串

那里的内联表为每种语言保存：页面标题、副标题、密码标签、按钮标签、密码错误提示。

### 4. 验证自动检测

检测逻辑会把 `navigator.language` 归一化为前两个字符，如果 `LANG` 中存在该语言就选择它，否则选择英文。

## 两种翻译机制

### (A) `data-i18n` 属性（声明式，用于 HTML）

```html
<h2 data-i18n="pt_title">Port configuration</h2>
<button class="ctl" data-i18n="c_apply" data-i18n-t="sy_dhcp_t">Apply</button>
<input class="in" data-i18n-p="l2_filter">
```

- `data-i18n` 设置元素的文本内容
- `data-i18n-t` 设置 `title` 属性（工具提示）
- `data-i18n-p` 设置 `placeholder` 属性

英文文本保留在标记中，既作为回退，也作为该键含义的权威依据。

### (B) `t("key")` 调用（命令式，用于 JavaScript）

```js
tr.insertCell().textContent=t("c_port")+" "+p;
toast(t("v_loaded",{n:vid}),"ok");
```

在所有语言中完全相同的字符串（`10M`、`2.5G`、`MAC`、`VLAN`、`CPU`、`RSTP`）直接写成字面量，不作为字典条目。

## 体积方面的考虑

- 每增加一种语言，`app.js` 压缩前大约增大 3 KB；构建会对该文件做 gzip 压缩，因此一种语言对 flash 的实际开销更接近 1 KB
- 最大的嵌入文件压缩后必须低于 64 KB（文件表中的 `uint16_t` 长度）；包含三种语言的 `app.js` 压缩后约 29 KB

## 构建

不需要任何特殊选项。`html/` 会在正常构建中被压缩并嵌入（参见 `webui-compression.md`）。
