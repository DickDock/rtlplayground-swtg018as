"use strict";
// Shared port status: the /status.json poller, the front-panel port strip
// and the system information table.
// Part of app.js: files in html/app/ are concatenated in filename order.
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
    if(up)el.style.setProperty("--pc","var("+(LINKC[p.link]||"--s1g")+")");
    lb.textContent=!p.enabled?t("c_off"):(p.link>0?LINKS[p.link]:t("c_down"));
    el.title=portRows(p).map(function(r){return r[0]+": "+r[1]}).join("\n");
  });
  if(S.detail!=null){var b=$("mbody");b.innerHTML="";b.appendChild(detailTable(S.ports[S.detail]));}
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
