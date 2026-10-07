"use strict";
// Links tab: link aggregation (static LAG + LACP) and spanning tree.
// Part of app.js: files in html/app/ are concatenated in filename order.

var HASHF=["spa","smac","dmac","sip","dip","sport","dport"];
var lagMasks=[0,0,0,0,0];
function lagBadge(g){
  var b=$("lgb"+g);
  if(!b||!S.n)return;
  var n=0,live=0;
  for(var p=1;p<=S.n;p++)if($("lg"+g+"p"+p)&&$("lg"+g+"p"+p).checked){
    n++;
    var q=S.ports[p-1];
    if(q&&q.portNum===p&&q.enabled&&q.link>0)live++;
  }
  b.textContent=n?(n+" "+t("lag_n")+(live?" · "+t("lag_up"):" · "+t("lag_down"))):t("c_off");
  b.className="badge"+(n&&live?" ok":"");
}
function buildLag(){
  var w=$("lagwrap");
  if(w.children.length)return;
  for(var g=1;g<=4;g++)(function(g){
    var card=h("div",{class:"card",style:"display:none"});
    card.appendChild(h("h2",null,[
      h("span",{text:"LAG "+g}),
      h("span",{class:"badge",id:"lgt"+g,style:"margin-left:8px"}),
      h("span",{class:"badge",id:"lgb"+g,style:"margin-left:auto"}),
    ]));
    var mr=h("div",{style:"display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px",class:"small"});
    mr.appendChild(h("span",{class:"mut",text:t("lag_mode")}));
    var ms=h("select",{class:"in",id:"lgm"+g});
    ms.appendChild(h("option",{value:"static",text:t("lag_static")}));
    ms.appendChild(h("option",{value:"lacp",text:"LACP"}));
    ms.addEventListener("change",function(){$("lgs"+g).textContent=ms.value==="lacp"?t("lacp_hint"):""});
    mr.appendChild(ms);
    card.appendChild(mr);
    card.appendChild(h("p",{class:"small mono",id:"lgs"+g,style:"margin-bottom:10px"}));
    card.appendChild(h("div",{class:"small mut",style:"margin-bottom:6px",text:t("lag_members")}));
    var pr=h("div",{class:"chipset",style:"margin-bottom:12px"});
    for(var p=1;p<=S.n;p++)pr.appendChild(h("label",{class:"pchk",title:t("c_port")+" "+p},[
      h("input",{type:"checkbox",id:"lg"+g+"p"+p}),
      h("span",null,[h("i",{id:"lgd"+g+"p"+p}),document.createTextNode(" "+p+" ")]),
    ]));
    card.appendChild(pr);
    card.appendChild(h("div",{class:"small mut",style:"margin-bottom:6px",text:t("lag_hash")}));
    var hr=h("div",{class:"chipset",style:"margin-bottom:14px"});
    HASHF.forEach(function(f){
      hr.appendChild(h("label",{class:"pchk",title:"laghash "+f},[
        h("input",{type:"checkbox",id:"lg"+g+"h"+f}),
        h("span",{text:t("lag_h_"+f)}),
      ]));
    });
    card.appendChild(hr);
    var acts=h("div",{style:"display:flex;gap:10px;flex-wrap:wrap"});
    acts.appendChild(h("button",{class:"ctl pri",text:t("c_apply"),onclick:function(){lagApply(g)}}));
    acts.appendChild(h("button",{class:"ctl danger",text:t("c_delete"),onclick:function(){
      confirmModal(t("lag_clear_q",{n:g}),t("lag_clear_d"),function(){
        delete card.dataset.dirty;
        var cmds=lacpCfg[g]?["lag "+g+" lacp off"]:[];
        postCmds(cmds.concat(["lag "+g+" d"])).then(lagLoad).catch(function(){});
      });
    }}));
    card.appendChild(acts);
    card.addEventListener("change",function(){card.dataset.dirty="1";lagBadge(g);});
    w.appendChild(card);
  })(g);
  $("lagnew").addEventListener("click",function(){
    for(var g=1;g<=4;g++){
      if(lacpCfg[g]||lagMasks[g])continue;
      var card=$("lgm"+g).closest(".card");
      card.style.display="";
      card.dataset.dirty="1";
      card.scrollIntoView({behavior:"smooth",block:"center"});
      return;
    }
    toast(t("lag_max"),"err");
  });
}
function stDots(hex){
  var v=parseInt(hex,16);
  function d(bit){return h("i",{class:(v&bit)?"on":""})}
  var w=h("span",{class:"stdots"},[d(8),d(0x10),d(0x20)]);
  w.title="Sync "+!!(v&8)+" / Coll "+!!(v&0x10)+" / Dist "+!!(v&0x20)+" (0x"+hex+")";
  return w;
}
var lacpCfg=[0,0,0,0,0];
function lagDots(){
  S.ports.forEach(function(p){
    var up=p.enabled&&p.link>0;
    for(var g=1;g<=4;g++){
      var d=$("lgd"+g+"p"+p.portNum);
      if(d)d.classList.toggle("up",!!up);
    }
  });
}
function lagLoad(){
  return getJSON("/lacp.json").then(function(c){
    var tb=$("lacptbl").tBodies[0];
    tb.innerHTML="";
    $("lacpempty").style.display=c.on?"none":"";
    c.lags.forEach(function(lg,i){
      var g=i+1;
      lacpCfg[g]=parseInt(lg.cfg,16);
      if(lacpCfg[g])lagMasks[g]=parseInt(lg.members,16);
      if($("lgm"+g).closest(".card").dataset.dirty)return;
      $("lgm"+g).value=lacpCfg[g]?"lacp":"static";
      $("lgs"+g).textContent=lacpCfg[g]?"LACP: "+t("lacp_agg")+" "+(lg.aggValid?lg.agg:"("+t("lacp_neg")+")")+", "+t("lacp_members")+" 0x"+lg.members:"";
    });
    if(c.on)c.ports.forEach(function(p){
      if(p.lag===255)return;
      var tr=tb.insertRow();
      tr.insertCell().textContent=p.p;
      tr.insertCell().textContent=p.lag+1;
      tr.insertCell().appendChild(stDots(p.a));
      tr.insertCell().appendChild(stDots(p.pt));
      tr.insertCell().textContent=p.rs;
      var rx=tr.insertCell();rx.className="num";rx.textContent=parseInt(p.rx,16);
      var ps=tr.insertCell();ps.className="mono";ps.textContent=p.psys;
    });
    return getJSON("/lag.json");
  }).then(function(s){
    s.forEach(function(l){
      var g=l.lagNum+1;
      if(!lacpCfg[g])lagMasks[g]=parseInt(l.members,2);
      if($("lgm"+g).closest(".card").dataset.dirty)return;
      var members=lacpCfg[g]||lagMasks[g];
      for(var p=1;p<=S.n;p++)
        $("lg"+g+"p"+p).checked=!!((members>>S.physToLog[p-1])&1);
      var hash=parseInt(l.hash,16);
      HASHF.forEach(function(f,i){$("lg"+g+"h"+f).checked=!!((hash>>i)&1)});
    });
    lagDots();
    for(var g2=1;g2<=4;g2++){
      var card=$("lgm"+g2).closest(".card");
      card.style.display=(lacpCfg[g2]||lagMasks[g2]||card.dataset.dirty)?"":"none";
      $("lgt"+g2).textContent=lacpCfg[g2]?"LACP":(lagMasks[g2]?t("lag_static"):"");
      lagBadge(g2);
    }
  });
}
function lagApply(g){
  var lacp=$("lgm"+g).value==="lacp",cmd="lag "+g+(lacp?" lacp":""),n=0,pre=[];
  delete $("lgm"+g).closest(".card").dataset.dirty;
  for(var p=1;p<=S.n;p++)if($("lg"+g+"p"+p).checked){cmd+=" "+p;n++;}
  if(!lacp&&lacpCfg[g])pre.push("lag "+g+" lacp off");
  if(lacp&&!n)cmd="lag "+g+" lacp off";
  if(!n&&!lacp){
    confirmModal(t("lag_clear_q",{n:g}),t("lag_clear_d"),function(){
      postCmds(pre.concat(["lag "+g+" d"])).then(lagLoad).catch(function(){});
    });
    return;
  }
  var hcmd="laghash "+g,nh=0;
  HASHF.forEach(function(f){if($("lg"+g+"h"+f).checked){hcmd+=" "+f;nh++;}});
  var cmds=pre.concat([cmd]);
  if(nh)cmds.push(hcmd);
  postCmds(cmds).then(lagLoad).catch(function(){});
}
var lagGen=0,lagPoller=new Poller(function(){return lagLoad().catch(function(){})},3000);

var STP_PF={EN:1,ADMEDGE:2,AUTOEDGE:4,BPDUG:8,ROOTG:16,FILTER:32,OPEREDGE:64,TRIP:128};
var stpSig="",stpCur=null;
function stpSel(id,opts){
  var s=h("select",{class:"in",id:id,onchange:stpTouch});
  opts.forEach(function(o){s.appendChild(h("option",{value:o[0],text:o[1]}))});
  return s;
}
function stpTouch(){this.closest("tr,.card").dataset.dirty="1"}
function fmtBridge(hex){
  if(!hex||hex.length<16)return"-";
  return parseInt(hex.slice(0,4),16)+" / "+hex.slice(4).replace(/(..)(?=.)/g,"$1:");
}
function stpKey(pt){return pt.lag?"L"+pt.lag:String(pt.p)}
function stpName(pt){return pt.lag?"LAG"+pt.lag+" ("+maskToPorts(pt.mbr).join(",")+")":String(pt.p)}
function stpPre(k){return k.charAt(0)==="L"?"stp lag "+k.slice(1)+" ":"stp port "+k+" "}
function stpBuild(ports){
  var tb=$("stpcfg").tBodies[0],st=$("stpstat").tBodies[0];
  tb.innerHTML="";st.innerHTML="";
  ports.forEach(function(pt){
    var p=stpKey(pt);
    var tr=tb.insertRow();
    tr.insertCell().textContent=stpName(pt);
    var sw=h("label",{class:"switch"},[h("input",{type:"checkbox",id:"sten"+p,onchange:stpTouch}),h("i")]);
    tr.insertCell().appendChild(sw);
    tr.insertCell().appendChild(stpSel("sted"+p,[["auto",t("c_auto")],["on",t("c_on")],["off",t("c_offc")]]));
    tr.insertCell().appendChild(h("input",{class:"in",id:"stco"+p,type:"number",min:"0",max:"200000000",style:"width:9em",onchange:stpTouch}));
    var pr=[];
    for(var v=0;v<=240;v+=16)pr.push([String(v),String(v)]);
    tr.insertCell().appendChild(stpSel("stpr"+p,pr));
    tr.insertCell().appendChild(stpSel("stgu"+p,[["none",t("stp_g_none")],["bpdu",t("stp_g_bpdu")],["root",t("stp_g_root")]]));
    tr.insertCell().appendChild(stpSel("stfi"+p,[["off",t("c_offc")],["on",t("c_on")]]));
    tr.insertCell().appendChild(stpSel("stpp"+p,[["auto",t("c_auto")],["on",t("c_on")],["off",t("c_offc")]]));
    tr.insertCell().appendChild(h("button",{class:"ctl",text:t("c_apply"),onclick:function(){stpApplyPort(p)}}));
    var sr=st.insertRow();
    sr.insertCell().textContent=stpName(pt);
    ["ro","st","db","dp","dc","oe","op"].forEach(function(k){sr.insertCell().id="st"+k+p});
  });
}
function stpPortVals(pt){
  var f=pt.f;
  return{
    en:!!(f&STP_PF.EN),
    edge:(f&STP_PF.ADMEDGE)?"on":((f&STP_PF.AUTOEDGE)?"auto":"off"),
    cost:parseInt(pt.pc,16),prio:String(pt.prio),
    guard:(f&STP_PF.BPDUG)?"bpdu":((f&STP_PF.ROOTG)?"root":"none"),
    filter:(f&STP_PF.FILTER)?"on":"off",
    p2p:["auto","on","off"][pt.p2]||"auto",
  };
}
function stpLoad(){
  return getJSON("/stp.json").then(function(s){
    s.ports.sort(function(a,b){return((a.lag||0)-(b.lag||0))||(a.p-b.p)});
    var sig=s.ports.map(function(pt){return stpKey(pt)+":"+(pt.mbr||0)}).join();
    if(sig!==stpSig){stpSig=sig;stpBuild(s.ports);}
    stpCur=s;
    var en=$("stpen");
    if(document.activeElement!==en)en.checked=!!s.on;
    var msg;
    if(!s.on)msg=t("stp_off_msg");
    else{
      var me=(s.prio*4096).toString(16).padStart(4,"0")+s.myMac;
      msg=t("stp_bridge")+" "+fmtBridge(me)+(s.weRoot
        ?" ("+t("stp_root_self")+")"
        :"; "+t("stp_root")+" "+fmtBridge(s.rootPrio+s.rootMac)+" "+t("stp_via")+" "+s.rootPort+", "+t("stp_cost")+" "+parseInt(s.cost,16))
        +"; "+t("stp_tc")+": "+parseInt(s.tc,16);
    }
    $("stpids").textContent=msg;
    var bc=$("stpbridge");
    if(!bc.dataset.dirty){
      $("stpver").value=s.rstp?"rstp":"stp";
      $("stpprio").value=String(s.prio);
      $("stphello").value=s.hello;$("stpmaxage").value=s.maxage;
      $("stpfwd").value=s.fwd;$("stptxhold").value=s.txhold;
    }
    s.ports.forEach(function(pt){
      var p=stpKey(pt);
      var trip=(pt.f&STP_PF.TRIP)?" "+badge(t("stp_trip"),"bad"):"";
      $("stro"+p).textContent=s.on&&pt.role?t("stp_r"+pt.role):"-";
      $("stst"+p).innerHTML=s.on?badge(t("stp_s"+pt.st),pt.st===3?"ok":"")+trip:"-";
      $("stdb"+p).textContent=s.on?fmtBridge(pt.db):"-";
      $("stdp"+p).textContent=s.on?parseInt(pt.dp.slice(0,2),16)+"."+parseInt(pt.dp.slice(2),16):"-";
      $("stdc"+p).textContent=s.on?parseInt(pt.dc,16):"-";
      $("stoe"+p).textContent=s.on?t((pt.f&STP_PF.OPEREDGE)?"c_yes":"c_no"):"-";
      $("stop"+p).textContent=s.on?t(pt.p2===2?"c_no":"c_yes"):"-";
      var row=$("sten"+p).closest("tr");
      if(row.dataset.dirty)return;
      var v=stpPortVals(pt);
      $("sten"+p).checked=v.en;$("sted"+p).value=v.edge;$("stco"+p).value=v.cost;
      $("stpr"+p).value=v.prio;$("stgu"+p).value=v.guard;$("stfi"+p).value=v.filter;$("stpp"+p).value=v.p2p;
    });
  }).catch(function(){});
}
function stpApplyPort(p){
  var cur=null;
  (stpCur?stpCur.ports:[]).forEach(function(pt){if(stpKey(pt)===p)cur=stpPortVals(pt)});
  var cost=parseInt($("stco"+p).value,10);
  if(isNaN(cost)||cost<0||cost>200000000){toast(t("stp_cost_err"),"err");return;}
  var w={en:$("sten"+p).checked,edge:$("sted"+p).value,cost:cost,prio:$("stpr"+p).value,
    guard:$("stgu"+p).value,filter:$("stfi"+p).value,p2p:$("stpp"+p).value};
  var cmds=[],pre=stpPre(p);
  if(!cur||w.edge!==cur.edge)cmds.push(pre+"edge "+w.edge);
  if(!cur||w.cost!==cur.cost)cmds.push(pre+"cost "+w.cost);
  if(!cur||w.prio!==cur.prio)cmds.push(pre+"prio "+w.prio);
  if(!cur||w.guard!==cur.guard)cmds.push(pre+"guard "+w.guard);
  if(!cur||w.filter!==cur.filter)cmds.push(pre+"filter "+w.filter);
  if(!cur||w.p2p!==cur.p2p)cmds.push(pre+"p2p "+w.p2p);
  if(!cur||w.en!==cur.en)cmds.push(pre+(w.en?"on":"off"));
  delete $("sten"+p).closest("tr").dataset.dirty;
  if(!cmds.length)return;
  postCmds(cmds).then(stpLoad).catch(function(){});
}
function stpBridgeApply(){
  var s=stpCur||{},cmds=[];
  var ver=$("stpver").value,prio=$("stpprio").value;
  if(ver!==(s.rstp?"rstp":"stp"))cmds.push("stp version "+ver);
  if(prio!==String(s.prio))cmds.push("stp prio "+prio);
  [["stphello","hello"],["stpmaxage","maxage"],["stpfwd","fwd"],["stptxhold","txhold"]].forEach(function(f){
    var v=$(f[0]).value;
    if(String(v)!==String(s[f[1]]))cmds.push("stp "+f[1]+" "+v);
  });
  delete $("stpbridge").dataset.dirty;
  if(!cmds.length)return;
  postCmds(cmds).then(stpLoad).catch(function(){});
}
$("stpbridge").addEventListener("change",function(){this.dataset.dirty="1"});
$("stpbapply").addEventListener("click",stpBridgeApply);
$("stpen").addEventListener("change",function(){
  var el=this,want=el.checked;
  el.checked=!want;
  confirmModal(t(want?"stp_en_q":"stp_dis_q"),t(want?"stp_en_d":"stp_dis_d"),
    function(){postCmd("stp "+(want?"on":"off")).then(stpLoad).catch(function(){})});
});
(function(){
  var sel=$("stpprio");
  for(var i=0;i<16;i++)sel.appendChild(h("option",{value:String(i),text:i+" ("+(i*4096)+")"}));
})();
var stpPoller=new Poller(stpLoad,3000);
tabHooks.links={
  enter:function(){
    var gen=++lagGen;
    needPorts(function(){
      if(gen!==lagGen||curTab!=="links")return;
      buildLag();
      lagPoller.start();
    });
    stpPoller.start();
  },
  leave:function(){lagGen++;lagPoller.stop();stpPoller.stop()},
};
