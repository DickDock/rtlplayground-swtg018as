// Link aggregation tab (static LAG + LACP).
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
tabHooks.lag={
  enter:function(){var gen=++lagGen;needPorts(function(){if(gen!==lagGen||curTab!=="lag")return;buildLag();lagPoller.start()})},
  leave:function(){lagGen++;lagPoller.stop()},
};

