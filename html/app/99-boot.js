"use strict";
// Boot: global event wiring, navigation rendering and the startup sequence.
// Part of app.js: files in html/app/ are concatenated in filename order.
["mousemove","mousedown","keydown","touchstart","wheel"].forEach(function(ev){
  addEventListener(ev,function(){lastInput=Date.now()},{passive:true});
});
TABS.forEach(function(tb){
  $("navlist").appendChild(h("li",{id:"nv-"+tb.id,onclick:function(){showTab(tb.id)}},[
    h("span",{html:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="'+tb.icon+'"/></svg>'}),
    h("span",{text:t("nav_"+tb.id)}),
  ]));
});
$("burger").addEventListener("click",function(){$("nav").classList.toggle("open")});
applyTheme();
$("themeSel").addEventListener("change",function(){
  try{localStorage.setItem("theme",this.value);}catch(e){}
  applyTheme();
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",applyTheme);
$("langSel").value=rtlLang;
$("langSel").addEventListener("change",function(){
  try{localStorage.setItem("rtl_lang",this.value);}catch(e){}
  location.reload();
});
i18nApply();
$("mx").addEventListener("click",closeModal);
$("mback").addEventListener("click",function(e){if(e.target===this)closeModal()});
$("saveBtn").addEventListener("click",saveRun);

// Old bookmarks pointed at the pre-merge tabs; map them so nothing 404s.
var OLD_TABS={stp:"links",lag:"links",eee:"ports",stats:"ports",bw:"flows",mirror:"flows",fw:"system"};
window.addEventListener("hashchange",function(){
  var id=location.hash.slice(1);
  if(OLD_TABS[id])id=OLD_TABS[id];
  if(TABS.some(function(tb){return tb.id===id})&&id!==curTab)showTab(id);
});
(function(){
  var id=location.hash.slice(1);
  if(OLD_TABS[id])id=OLD_TABS[id];
  if(!TABS.some(function(tb){return tb.id===id}))id="dash";
  pollInfo().catch(function(){});
  getText("/cmd_log").then(function(x){
    x=x.replace(/\0[\s\S]*$/,"").trim();
    if(x&&x.split(/\r?\n/).some(function(l){return isConfCmd(l.trim())}))setDirty(true);
  }).catch(function(){});
  showTab(id);
})();
