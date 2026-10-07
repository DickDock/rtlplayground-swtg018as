"use strict";
// Core: global state, DOM helpers, api() queue, Poller, toast/modal, tabs.
// Part of app.js: files in html/app/ are concatenated in filename order.
// No DOM side effects at top level; boot wiring lives in 99-boot.js.
var S={
  ports:[],n:0,physToLog:[],logToPhys:[],sfpSlot:[],info:{},detail:null,
  dirty:false,prev:null,prevT:0,rates:[],mtu:[],histR:[],histT:[],histE:[],
  chartSpan:120,
};
// Traffic history: up to HIST_MAX samples of HIST_DT seconds each. Lives
// here, not in 10-dash.js, because pollStatus (04-status.js) trims the
// ring and runs in harnesses that never load the dashboard file.
var HIST_MAX=360,HIST_DT=2.5;
var LINKS=["Down","10M","100M","1000M","500M","10G","2.5G","5G"];
var LINKC=[null,"--s10","--s100","--s1g","--s5g","--s10g","--s2g5","--s5g"];
var $=function(id){return document.getElementById(id)};
function h(tag,attrs,kids){
  var e=document.createElement(tag);
  if(attrs)for(var k in attrs){
    if(k==="text")e.textContent=attrs[k];
    else if(k==="html")e.innerHTML=attrs[k];
    else if(k.slice(0,2)==="on")e.addEventListener(k.slice(2),attrs[k]);
    else e.setAttribute(k,attrs[k]);
  }
  if(kids)kids.forEach(function(c){e.appendChild(c)});
  return e;
}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function badge(txt,cls){return'<span class="badge'+(cls?" "+cls:"")+'">'+esc(txt)+"</span>"}
/* Speed badge for an up link: one shared encoding for every link column —
 * the .s* class derives from the same LINKC token the front-panel rate label
 * uses, and the green dot carries the "link up" state (not the speed). */
function spdBadge(p){
  var cls=LINKC[p.link]||"--s1g";
  return'<span class="badge spd '+cls.slice(2)+'"><i class="udot"></i>'+esc(LINKS[p.link])+"</span>";
}
/* admin-down ("off", dashed ghost) and link-down ("down", plain gray) must
 * read differently at a glance — mirrors .port.dis vs .port:not(.up). */
function linkBadge(p){
  return!p.enabled?badge(t("c_off"),"off")
    :(p.link>0?spdBadge(p):badge(t("c_down"),"down"));
}
/* Error counters: non-zero → red (.nz), zero → dim gray (.nz0). Shared by the
 * dashboard traffic table and the port statistics table so both pages agree. */
function errCell(cell,v){
  var on=BigInt(v)>0n;
  cell.classList.toggle("nz",on);
  cell.classList.toggle("nz0",!on);
}
/* 64-bit counters: compact auto-unit for the cell, exact grouped value in the
 * tooltip (the MIB modal keeps the raw digits). */
function fmtGroup(v){return BigInt(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g,",")}
function fmtBig(v){
  var n=Number(v),u=n>=1e9?"G":n>=1e6?"M":n>=1e3?"k":"";
  if(!u)return BigInt(v).toString();
  var d=n/{G:1e9,M:1e6,k:1e3}[u];
  var s=d>=100?d.toFixed(0):d>=10?d.toFixed(1):d.toFixed(2);
  return s.replace(/\.0+$|(\.\d*?)0+$/,"$1").replace(/\.$/,"")+" "+u;
}
/* Sidebar count badges: best-effort, silently skipped when absent. */
function navCount(id,v){
  var el=$("nvc-"+id);
  if(el&&v!=null)el.textContent=String(v);
}
function applyTheme(){
  var pref="auto";
  try{pref=localStorage.getItem("theme")||"auto";}catch(e){}
  var dark=false;
  try{dark=window.matchMedia("(prefers-color-scheme: dark)").matches;}catch(e){}
  document.documentElement.dataset.theme=pref==="dark"||(pref!=="light"&&dark)?"dark":"light";
  var sel=$("themeSel");
  if(sel)sel.value=pref;
}

/* The firmware shares one output buffer across connections and delimits
 * responses by closing, so the next request must wait for the previous
 * BODY, not just its headers. */
var _q=Promise.resolve();
function api(path,opts){
  return new Promise(function(resolve,reject){
    _q=_q.then(function(){
      opts=opts||{};
      var ctl=("AbortController"in window)?new AbortController():null;
      if(ctl)opts.signal=ctl.signal;
      var to=setTimeout(function(){if(ctl)ctl.abort()},10000);
      try{
        return fetch(path,opts).then(function(r){
          if(r.status===401){clearTimeout(to);location.href="/login.html";throw new Error("auth");}
          return r.text().then(function(body){
            clearTimeout(to);
            resolve({ok:r.ok,status:r.status,body:body});
          });
        }).catch(function(e){clearTimeout(to);reject(e)});
      }catch(e){clearTimeout(to);reject(e);}
    });
  });
}
function getJSON(p){return api(p).then(function(r){if(!r.ok)throw new Error(p+" "+r.status);return JSON.parse(r.body)})}
function getText(p){return api(p).then(function(r){if(!r.ok)throw new Error(p+" "+r.status);return r.body})}

function toast(msg,cls){
  var el=h("div",{class:"toast "+(cls||""),text:msg});
  $("toasts").appendChild(el);
  setTimeout(function(){el.style.opacity="0";el.style.transition="opacity .3s";},3400);
  setTimeout(function(){el.remove()},3800);
}
function modal(title,bodyEl,buttons,cleanup){
  closeModal();
  S.modalCleanup=cleanup||null;
  $("mtitle").textContent=title;
  var b=$("mbody");b.innerHTML="";b.appendChild(bodyEl);
  var f=$("mfoot");f.innerHTML="";
  (buttons||[]).forEach(function(bt){f.appendChild(bt)});
  $("mback").classList.add("show");
}
function closeModal(){
  var cleanup=S.modalCleanup;
  S.modalCleanup=null;S.detail=null;
  $("mback").classList.remove("show");
  if(cleanup)cleanup();
}
function confirmModal(title,detail,onok){
  var b=h("div");
  if(detail)b.appendChild(h("p",{class:"small",text:detail}));
  modal(title,b,[
    h("button",{class:"ctl",text:t("c_cancel"),onclick:closeModal}),
    h("button",{class:"ctl pri",text:t("c_confirm"),onclick:function(){closeModal();onok()}}),
  ]);
}

var TABS=[
  {id:"dash",  grp:"overview",icon:"M3 13h4v8H3zM10 8h4v13h-4zM17 3h4v18h-4z"},
  {id:"ports", grp:"switch",  icon:"M2 7h20v10H2zM6 11v2M10 11v2M14 11v2M18 11v2"},
  {id:"vlan",  grp:"switch",  icon:"M12 3v6M12 9l-7 5M12 9l7 5M5 14v5M19 14v5M3 21h4M17 21h4"},
  {id:"l2",    grp:"switch",  icon:"M4 5h16M4 12h16M4 19h10"},
  {id:"links", grp:"switch",  icon:"M7 8a4 4 0 100 8h3M17 8a4 4 0 110 8h-3M9 12h6"},
  {id:"flows", grp:"manage",  icon:"M4 18a8 8 0 0116 0M12 18l4-6"},
  {id:"system",grp:"manage",  icon:"M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h2M18 12h2M12 4v2M12 18v2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M7.5 16.5L6 18"},
];
var curTab="dash";
var tabHooks={};
function showTab(id){
  closeModal();
  var old=tabHooks[curTab];
  if(old&&old.leave)old.leave();
  curTab=id;
  TABS.forEach(function(tb){
    var sec=$("tab-"+tb.id);
    if(sec)sec.classList.toggle("act",tb.id===id);
    var nv=$("nv-"+tb.id);
    if(nv)nv.classList.toggle("act",tb.id===id);
  });
  var tt=$("ttitle");
  if(tt)tt.textContent=t("nav_"+id);
  var nav=$("nav");
  if(nav)nav.classList.remove("open");
  if(location.hash!=="#"+id)history.replaceState(null,"","#"+id);
  var hk=tabHooks[id];
  if(hk&&hk.enter)hk.enter();
}

var IDLE_STOP_MS=600000,lastInput=Date.now();
function Poller(fn,ms){this.fn=fn;this.ms=ms;this.on=false;this.t=null;this.gen=0;this.busy=false}
Poller.prototype.start=function(){if(this.on)return;this.on=true;this.gen++;this.tick()};
Poller.prototype.stop=function(){if(!this.on)return;this.on=false;this.gen++;clearTimeout(this.t);this.t=null};
Poller.prototype.tick=function(gen){
  var self=this;
  if(gen==null)gen=self.gen;
  if(!self.on||gen!==self.gen||self.busy)return;
  clearTimeout(self.t);self.t=null;self.busy=true;
  // 停止使旧微任务失效；已发请求不取消，重启只在它结束后接管一次。
  Promise.resolve().then(function(){
    if(self.on&&gen===self.gen&&!document.hidden&&Date.now()-lastInput<=IDLE_STOP_MS)return self.fn();
  }).catch(function(){}).then(function(){
    self.busy=false;
    if(!self.on)return;
    if(gen!==self.gen){self.tick();return;}
    self.t=setTimeout(function(){if(self.on&&gen===self.gen){self.t=null;self.tick(gen)}},self.ms);
  });
};

function byPort(a){return a.sort(function(x,y){return x.portNum-y.portNum})}
function fmtPps(v){
  if(v==null)return"-";
  if(v>=1e6)return(v/1e6).toFixed(1)+" M";
  if(v>=1e3)return(v/1e3).toFixed(1)+" k";
  return Math.round(v);
}
function portLabel(p){return p.name?p.portNum+" "+p.name:String(p.portNum)}
