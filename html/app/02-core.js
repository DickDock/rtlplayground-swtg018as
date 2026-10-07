// Core: state, i18n runtime, DOM helpers, api() queue, Poller, toast/modal,
// tabs and shared status helpers.
// Part of app.js: files in html/app/ are concatenated in filename order.
var rtlLang="zh";
function t(k,v){
  var s=LANG[rtlLang][k]||LANG.en[k]||k;
  if(v)for(var x in v)s=s.split("{"+x+"}").join(v[x]);
  return s;
}
function i18nApply(){
  document.querySelectorAll("[data-i18n]").forEach(function(el){el.textContent=t(el.getAttribute("data-i18n"))});
  document.querySelectorAll("[data-i18n-t]").forEach(function(el){el.title=t(el.getAttribute("data-i18n-t"))});
  document.querySelectorAll("[data-i18n-p]").forEach(function(el){el.placeholder=t(el.getAttribute("data-i18n-p"))});
}

var S={
  ports:[],n:0,physToLog:[],logToPhys:[],sfpSlot:[],info:{},detail:null,
  dirty:false,prev:null,prevT:0,rates:[],mtu:[],histR:[],histT:[],pbSig:"",
};
var LINKS=["Down","10M","100M","1000M","500M","10G","2.5G","5G"];
var LINKC=[null,"--s10","--s100","--s1000","--s5g","--s10g","--s2g5","--s5g"];
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
function linkBadge(p){
  return!p.enabled?badge(t("c_off")):(p.link>0?badge(LINKS[p.link],"ok"):badge(t("c_down")));
}

function applyTheme(){
  var pref;
  try{pref=localStorage.getItem("theme")||"auto";}catch(e){pref="auto";}
  var dark=window.matchMedia("(prefers-color-scheme: dark)").matches;
  var th=pref;
  if(pref==="auto")th=dark?"dark":"light";
  if(pref==="auto-sel")th=dark?"sel-dark":"sel-light";
  document.documentElement.dataset.theme=th;
  $("themeSel").value=pref;
}
$("themeSel").addEventListener("change",function(){
  try{localStorage.setItem("theme",this.value);}catch(e){}
  applyTheme();
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",applyTheme);
applyTheme();
$("langSel").value=rtlLang;
$("langSel").addEventListener("change",function(){
  try{localStorage.setItem("rtl_lang",this.value);}catch(e){}
  location.reload();
});
i18nApply();

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
      return fetch(path,opts).then(function(r){
        if(r.status===401){clearTimeout(to);location.href="/login.html";throw new Error("auth");}
        return r.text().then(function(body){
          clearTimeout(to);
          resolve({ok:r.ok,status:r.status,body:body});
        });
      }).catch(function(e){clearTimeout(to);reject(e)});
    });
  });
}
function getJSON(p){return api(p).then(function(r){if(!r.ok)throw new Error(p+" "+r.status);return JSON.parse(r.body)})}
function getText(p){return api(p).then(function(r){if(!r.ok)throw new Error(p+" "+r.status);return r.body})}

var CONF_CMDS=[
  /^ip\s+(\d{1,3}\.){3}\d{1,3}$/,/^ip\s+dhcp$/,
  /^gw\s+(\d{1,3}\.){3}\d{1,3}$/,/^netmask\s+(\d{1,3}\.){3}\d{1,3}$/,
  /^syslog\s+(on|off)$/,/^syslog\s+ip\s+(\d{1,3}\.){3}\d{1,3}$/,/^syslog\s+port\s+\d{1,5}$/,
  /^session\s+\d{1,5}$/,
  /^passwd\s+\S+$/,/^hostname\s+\S{1,23}$/,
  /^vlan\s+\d{1,4}\s+d$/,/^vlan\s+\d{1,4}\s+mgmt$/,
  /^vlan\s+\d{1,4}(\s+[a-zA-Z]\w*)?(\s+\d{1,2}t?)+$/,
  /^pvid\s+\d{1,2}\s+\d{1,4}$/,
  /^ingress(\s+\d{1,2}[tua])+$/,/^ingress\s+[tua]$/,
  /^port\s+\d{1,2}\s+(10m|100m|1g|2g5|5g|10g|auto|on|off)(\s+(half|full))?$/,
  /^port\s+\d{1,2}\s+name\s+\S+$/,
  /^eee\s+(on|off)(\s+\d{1,2})?(\s+(100m|1g|2g5))?$/,
  /^mirror(\s+\d{1,2})(\s+\d{1,2}[tr]?)+$/,/^mirror\s+off$/,
  /^lag\s+[1-4](\s+\d{1,2})+$/,/^lag\s+[1-4]\s+d$/,/^lag\s+[1-4]\s+lacp(\s+\d{1,2})+$/,/^lag\s+[1-4]\s+lacp\s+off$/,/^laghash\s+[1-4](\s+\w+)+$/,
  /^isolate\s+\d{1,2}(\s+(off|\d{1,2}))+$/,
  /^stp\s+(on|off)$/,/^stp\s+(prio|hello|maxage|fwd|txhold)\s+\d{1,2}$/,
  /^stp\s+version\s+(rstp|stp)$/,
  /^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+(on|off)$/,/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+edge\s+(on|off|auto)$/,
  /^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+cost\s+\d{1,9}$/,/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+prio\s+\d{1,3}$/,
  /^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+guard\s+(none|bpdu|root)$/,/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+filter\s+(on|off)$/,
  /^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+p2p\s+(auto|on|off)$/,
  /^igmp\s+(on|off)$/,/^mtu\s+\d{1,2}\s+\d+$/,
  /^bw\s+(in|out)\s+\d{1,2}\s+\S+$/,
  /^storm\s+\d{1,2}\s+(bcast|mcast|ucast|umcast)\s+(off|\d{1,8}\s+(pps|kbps))$/,
  /^qos\s+trust\s+(dscp|1p|port)$/,/^qos\s+dscp\s+\S+\s+\d$/,/^qos\s+(1p|queue)\s+\d\s+\d$/,
  /^qos\s+port\s+\d{1,2}\s+\d$/,/^qos\s+sched\s+\d{1,2}\s+\d\s+(strict|\d{1,3})$/,
  /^fc\s+\d{1,2}\s+(auto|on|off)$/,/^fc\s+\d{1,2}\s+set\s+\d$/,/^fc\s+thr\s+(glb|\d)\s+\S+\s+\S+$/,
  /^fc\s+guar\s+\d\s+\S+$/,
  /^pfc\s+\d{1,2}\s+(on\s+[0-7](,[0-7])*|off|map)$/,
];
function isConfCmd(line){
  for(var i=0;i<CONF_CMDS.length;i++)if(CONF_CMDS[i].test(line))return true;
  return false;
}
function setDirty(d){
  S.dirty=d;
  $("dirty").classList.toggle("show",d);
}
function postCmd(cmd,quiet){
  return api("/cmd",{method:"POST",body:cmd}).then(function(r){
    if(!r.ok)throw new Error(((r.body||"").split("\n")[0])||t("t_rejected",{c:cmd}));
    if(isConfCmd(cmd.trim()))setDirty(true);
    if(!quiet)toast(t("t_applied",{c:cmd}),"ok");
    return r;
  },function(e){toast(e.message||t("t_failed",{c:cmd}),"err");throw e;});
}
function postCmds(list){
  var p=Promise.resolve();
  list.forEach(function(c){p=p.then(function(){return postCmd(c,true)})});
  return p.then(function(){toast(t("t_cmds",{n:list.length}),"ok")});
}

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
$("mx").addEventListener("click",closeModal);
$("mback").addEventListener("click",function(e){if(e.target===this)closeModal()});
function confirmModal(title,detail,onok){
  var b=h("div");
  if(detail)b.appendChild(h("p",{class:"small",text:detail}));
  modal(title,b,[
    h("button",{class:"ctl",text:t("c_cancel"),onclick:closeModal}),
    h("button",{class:"ctl pri",text:t("c_confirm"),onclick:function(){closeModal();onok()}}),
  ]);
}

var TABS=[
  {id:"dash",  icon:"M3 13h4v8H3zM10 8h4v13h-4zM17 3h4v18h-4z"},
  {id:"ports", icon:"M2 7h20v10H2zM6 11v2M10 11v2M14 11v2M18 11v2"},
  {id:"stp",   icon:"M12 3v5M12 8L5 13v8M12 8l7 5v8M2 21h20"},
  {id:"stats", icon:"M4 20V10M10 20V4M16 20v-7M22 20H2"},
  {id:"vlan",  icon:"M12 3v6M12 9l-7 5M12 9l7 5M5 14v5M19 14v5M3 21h4M17 21h4"},
  {id:"l2",    icon:"M4 5h16M4 12h16M4 19h10"},
  {id:"mirror",icon:"M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4"},
  {id:"lag",   icon:"M7 8a4 4 0 100 8h3M17 8a4 4 0 110 8h-3M9 12h6"},
  {id:"eee",   icon:"M13 2L4 14h6l-1 8 9-12h-6z"},
  {id:"bw",    icon:"M4 18a8 8 0 0116 0M12 18l4-6"},
  {id:"system",icon:"M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h2M18 12h2M12 4v2M12 18v2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M7.5 16.5L6 18"},
  {id:"fw",    icon:"M12 3v12M8 11l4 4 4-4M4 19h16"},
];
var curTab="dash";
var tabHooks={};
function showTab(id){
  closeModal();
  var old=tabHooks[curTab];
  if(old&&old.leave)old.leave();
  curTab=id;
  TABS.forEach(function(tb){
    $("tab-"+tb.id).classList.toggle("act",tb.id===id);
    $("nv-"+tb.id).classList.toggle("act",tb.id===id);
  });
  $("ttitle").textContent=t("nav_"+id);
  $("nav").classList.remove("open");
  if(location.hash!=="#"+id)history.replaceState(null,"","#"+id);
  var hk=tabHooks[id];
  if(hk&&hk.enter)hk.enter();
}
TABS.forEach(function(tb){
  $("navlist").appendChild(h("li",{id:"nv-"+tb.id,onclick:function(){showTab(tb.id)}},[
    h("span",{html:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="'+tb.icon+'"/></svg>'}),
    h("span",{text:t("nav_"+tb.id)}),
  ]));
});
$("burger").addEventListener("click",function(){$("nav").classList.toggle("open")});

var IDLE_STOP_MS=600000,lastInput=Date.now();
["mousemove","mousedown","keydown","touchstart","wheel"].forEach(function(ev){
  addEventListener(ev,function(){lastInput=Date.now()},{passive:true});
});
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
function pollStatus(){
  return getJSON("/status.json").then(function(s){
    byPort(s);
    var now=Date.now();
    if(!S.n){
      S.n=s.length;
      var slot=0;
      s.forEach(function(p){
        S.physToLog[p.portNum-1]=p.logPort;
        S.logToPhys[p.logPort]=p.portNum;
        if(p.isSFP){slot++;S.sfpSlot[p.portNum-1]=slot;}
      });
      buildStrip();
    }
    if(S.prev){
      var dt=(now-S.prevT)/1000;
      if(dt>0.2)s.forEach(function(p,i){
        var q=S.prev[i];
        if(q)S.rates[p.portNum-1]={
          tx:Number(BigInt(p.txG)-BigInt(q.txG))/dt,
          rx:Number(BigInt(p.rxG)-BigInt(q.rxG))/dt,
        };
      });
    }
    S.prev=s;S.prevT=now;S.ports=s;
    var sr=0,sx=0;
    S.rates.forEach(function(r){if(r){sr+=r.rx;sx+=r.tx;}});
    S.histR.push(sr);S.histT.push(sx);
    if(S.histR.length>120){S.histR.shift();S.histT.shift();}
    updateStrip();
    var hk=tabHooks[curTab];
    if(hk&&hk.status)hk.status();
  });
}
var statusPoller=new Poller(pollStatus,2500);
function needPorts(fn){
  if(S.n)return fn();
  pollStatus().then(fn).catch(function(){});
}
function fmtPps(v){
  if(v==null)return"-";
  if(v>=1e6)return(v/1e6).toFixed(1)+" M";
  if(v>=1e3)return(v/1e3).toFixed(1)+" k";
  return Math.round(v);
}
function portLabel(p){return p.name?p.portNum+" "+p.name:String(p.portNum)}

function buildStrip(){
  var st=$("strip");st.innerHTML="";
  for(var i=0;i<S.n;i++)(function(i){
    var p=S.ports[i]||{};
    st.appendChild(h("div",{class:"port"+(p.isSFP?" sfp":""),id:"pp"+i,onclick:function(){portDetail(i)}},[
      h("span",{class:"pn",text:String(i+1)}),
      h("i",{class:"jack"}),
      h("span",{class:"ps",id:"ppl"+i,text:"..."}),
    ]));
  })(i);
}
function updateStrip(){
  S.ports.forEach(function(p){
    var i=p.portNum-1,el=$("pp"+i),lb=$("ppl"+i);
    if(!el)return;
    el.classList.toggle("dis",!p.enabled);
    var up=p.enabled&&p.link>0;
    el.classList.toggle("up",!!up);
    if(up)el.style.setProperty("--pc","var("+(LINKC[p.link]||"--s1000")+")");
    lb.textContent=!p.enabled?t("c_off"):(p.link>0?LINKS[p.link]:t("c_down"));
    el.title=portRows(p).map(function(r){return r[0]+": "+r[1]}).join("\n");
  });
  if(S.detail!=null){var b=$("mbody");b.innerHTML="";b.appendChild(detailTable(S.ports[S.detail]));}
}

// DDM 读取失败可能只返回 "0x"，不能用位运算把 NaN 变成有效零读数。
function pU16(v){return /^(0x)?[0-9a-f]{1,4}$/i.test(v)?parseInt(v,16):NaN}
function pI16(v){var x=pU16(v);return x>=0x8000?x-0x10000:x}
function ddmFmt(v,n,unit){return isFinite(v)?v.toFixed(n)+unit:"-"}
function calSO(val,cal){
  if(typeof cal!=="string")return val;
  if(cal.slice(0,2)==="0x")cal=cal.slice(2);
  if(!/^[0-9a-f]{8}$/i.test(cal))return NaN;
  return(pU16(cal.slice(0,4))/256)*val+pI16(cal.slice(4,8));
}
function calRx(val,cal){
  if(typeof cal!=="string")return val;
  if(cal.slice(0,2)==="0x")cal=cal.slice(2);
  if(!/^[0-9a-f]{40}$/i.test(cal))return NaN;
  var b=cal.match(/.{2}/g).map(function(x){return parseInt(x,16)});
  var v=new DataView(new Uint8Array(b).buffer);
  return v.getFloat32(0)*Math.pow(val,4)+v.getFloat32(4)*Math.pow(val,3)
    +v.getFloat32(8)*Math.pow(val,2)+v.getFloat32(12)*val+v.getFloat32(16);
}
function dBm(mw){return 10*Math.log10(Math.max(mw,1e-4))}
function portRows(p){
  var rows=[[t("c_port"),String(p.portNum)],[t("c_type"),p.isSFP?"SFP":"RJ45"]];
  if(p.name)rows.push([t("c_name"),p.name]);
  rows.push([t("p_state"),!p.enabled?t("p_disabled"):(p.link>0?t("p_up")+" "+LINKS[p.link]:t("c_down"))]);
  rows.push([t("p_txgb"),BigInt(p.txG)+" / "+BigInt(p.txB)+" "+t("p_pkts")]);
  rows.push([t("p_rxgb"),BigInt(p.rxG)+" / "+BigInt(p.rxB)+" "+t("p_pkts")]);
  if(p.isSFP){
    if(p.sfp_vendor)rows.push([t("p_module"),[p.sfp_vendor,p.sfp_model,p.sfp_serial].filter(Boolean).join(" / ")]);
    var ext=p.sfp_options&0x40,state=pU16(p.sfp_state);
    if(ext){
      var tx=calSO(pU16(p.sfp_txpower),p.sfp_txpower_cal)/10000;
      var rx=calRx(pU16(p.sfp_rxpower),p.sfp_rxpower_cal)/10000;
      rows.push([t("p_temp"),ddmFmt(calSO(pI16(p.sfp_temp),p.sfp_temp_cal)/256,1," \u00b0C")]);
      rows.push([t("p_vcc"),ddmFmt(calSO(pU16(p.sfp_vcc),p.sfp_vcc_cal)/10000,2," V")]);
      rows.push([t("p_txbias"),ddmFmt(calSO(pU16(p.sfp_txbias),p.sfp_txbias_cal)/500,1," mA")]);
      rows.push([t("p_txpower"),isFinite(tx)?ddmFmt(tx,3," mW / ")+ddmFmt(dBm(tx),2," dBm"):"-"]);
      rows.push([t("p_rxpower"),isFinite(rx)?ddmFmt(rx,3," mW / ")+ddmFmt(dBm(rx),2," dBm"):"-"]);
      rows.push([t("p_txfault"),isFinite(state)?t((state&0x4)?"c_yes":"c_no"):"-"]);
      rows.push([t("p_txdis"),isFinite(state)?t((state&0x80)?"c_yes":"c_no"):"-"]);
    }
    var losPin=(p.sfp_los!=null)?!!Number(p.sfp_los):null;
    var losMod=ext&&isFinite(state)?!!(state&0x2):null;
    if(losPin!=null||losMod!=null){
      var v=(losMod!=null&&losPin!=null&&losMod!==losPin)
        ?("pin="+losPin+" mod="+losMod+" !"):t((losMod!=null?losMod:losPin)?"c_yes":"c_no");
      rows.push([t("p_rxlos"),v]);
    }
  }else if(p.adv){
    var bits=parseInt(p.adv,2),names=["10M "+t("c_half"),"10M "+t("c_full"),"100M "+t("c_half"),"100M "+t("c_full"),"1G","2.5G"];
    var on=names.filter(function(_,b){return bits&(1<<b)});
    rows.push([t("p_adv"),on.join(", ")||"-"]);
  }
  return rows;
}
function detailTable(p){
  var tb=h("table",{class:"t"});
  portRows(p).forEach(function(r){
    tb.appendChild(h("tr",null,[h("td",{class:"mut",text:r[0]}),h("td",{text:r[1]})]));
  });
  return tb;
}
function portDetail(i){
  if(!S.ports[i])return;
  modal(t("c_port")+" "+(i+1),detailTable(S.ports[i]));
  S.detail=i;
}

function renderInfo(){
  var m=[["i_host","hostname"],["i_ip","ip_address"],["i_mask","ip_netmask"],
    ["i_gw","ip_gateway"],["i_mac","mac_address"],["i_fw","sw_ver"],["i_built","build_date"],
    ["i_hw","hw_ver"],["i_temp","chip_temp"],["i_flash","flash_size"],["i_syslog","syslog_server"]];
  var tb=$("sysinfo");tb.innerHTML="";
  m.forEach(function(r){
    var v=S.info[r[1]];
    if(v==null||v==="")return;
    tb.appendChild(h("tr",null,[h("td",{class:"mut",text:t(r[0])}),h("td",{class:"mono",text:String(v)})]));
  });
  if(S.info.hostname){$("brandname").textContent=$("brandname").title=S.info.hostname;document.title=S.info.hostname;}
  if(S.info.sw_ver)$("fver").textContent="RTLPlayground "+S.info.sw_ver;
}
function pollInfo(){
  return getJSON("/information.json").then(function(j){S.info=j;renderInfo()});
}
