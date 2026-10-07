// Ports tab: per-port configuration.
// Part of app.js: files in html/app/ are concatenated in filename order.
var SPEEDS=[["auto","c_auto"],["2g5","2.5G"],["1g","1G"],["100m full","100M full"],
  ["100m half","100M half"],["10m full","10M full"],["10m half","10M half"]];
var SFPRATES=[["auto","c_auto"],["10g","10G"],["2g5","2.5G"],["1g","1G"],["100m","100M"]];
var ADVSEL={63:"auto",31:"auto",32:"2g5",16:"1g",8:"100m full",4:"100m half",2:"10m full",1:"10m half"};
function speedLabel(s){
  if(s==="c_auto")return t("c_auto");
  return s.replace(" full"," "+t("c_full")).replace(" half"," "+t("c_half"));
}
function buildPorts(){
  var tb=$("ptable").tBodies[0];
  if(tb.rows.length||!S.n)return;
  S.ports.forEach(function(p){
    var i=p.portNum-1;
    var spd=h("select",{class:"in",id:"pspd"+i});
    (p.isSFP?SFPRATES:SPEEDS).forEach(function(o){
      spd.appendChild(h("option",{value:o[0],text:speedLabel(o[1])}));
    });
    var tr=tb.insertRow();
    tr.insertCell().textContent=p.portNum+(p.isSFP?" (SFP)":"");
    tr.insertCell().appendChild(h("input",{class:"in",id:"pname"+i,size:"9",maxlength:"15",value:p.name||"",placeholder:"-"}));
    tr.insertCell().id="plink"+i;
    var mc=tr.insertCell();mc.id="pmac"+i;mc.className="mono";mc.textContent="-";
    tr.insertCell().appendChild(spd);
    var sw=h("label",{class:"switch"},[h("input",{type:"checkbox",id:"pen"+i}),h("i")]);
    sw.firstChild.checked=!!p.enabled;
    tr.insertCell().appendChild(sw);
    tr.insertCell().appendChild(h("input",{class:"in sm",id:"pmtu"+i,type:"number",min:"64",max:"16383"}));
    tr.insertCell().appendChild(h("button",{class:"ctl",text:t("c_apply"),onclick:function(){applyPort(i)}}));
  });
  loadMtu();
}
function loadMtu(){
  return getJSON("/mtu.json").then(function(s){
    s.forEach(function(m){
      S.mtu[m.portNum-1]=parseInt(m.mtu,16);
      var el=$("pmtu"+(m.portNum-1));
      if(el&&document.activeElement!==el)el.value=parseInt(m.mtu,16);
    });
  });
}
/* One learned MAC is the attached device; several means a switch or AP
 * sits behind the port, so only the count is shown. */
function portsMacs(){
  l2Load().then(function(all){
    var by={};
    all.forEach(function(e){
      if(e.pport==="CPU")return;
      var l=by[e.pport]=by[e.pport]||[];
      if(l.indexOf(e.mac)<0)l.push(e.mac);
    });
    S.ports.forEach(function(p){
      var el=$("pmac"+(p.portNum-1));
      if(!el)return;
      var m=by[p.portNum]||[];
      el.textContent=!m.length?"-":(m.length===1?m[0]:m.length+" "+t("c_devices"));
      el.title=m.join("\n");
    });
  }).catch(function(){});
}
var _macTick=0;
function portsStatus(){
  buildPorts();
  if(++_macTick%10===0)portsMacs();
  S.ports.forEach(function(p){
    var i=p.portNum-1,el=$("plink"+i);
    if(el)el.innerHTML=linkBadge(p);
    var sel=$("pspd"+i),v=p.isSFP?0:ADVSEL[parseInt(p.adv,2)];
    if(sel&&v&&document.activeElement!==sel)sel.value=v;
  });
}
function applyPort(i){
  var p=S.ports[i],cmds=[];
  var name=$("pname"+i).value.trim();
  var en=$("pen"+i).checked;
  var spd=$("pspd"+i).value;
  var mtu=parseInt($("pmtu"+i).value,10);
  if(name&&name!==(p.name||"")){
    if(!/^\S{1,15}$/.test(name)){toast(t("pt_name_err"),"err");return;}
    cmds.push("port "+p.portNum+" name "+name);
  }
  if(!en)cmds.push("port "+p.portNum+" off");
  else if(p.isSFP){
    if(!p.enabled)cmds.push("port "+p.portNum+" on");
    cmds.push("sfp "+S.sfpSlot[i]+" "+spd);
  }else cmds.push("port "+p.portNum+" "+spd);
  if(mtu&&mtu!==S.mtu[i]){
    if(mtu<64||mtu>16383){toast(t("pt_mtu_err"),"err");return;}
    cmds.push("mtu "+p.portNum+" "+mtu);
  }
  postCmds(cmds).then(loadMtu).catch(function(){});
}
tabHooks.ports={
  enter:function(){statusPoller.start();needPorts(function(){buildPorts();portsMacs()})},
  leave:function(){statusPoller.stop();l2Gen++},
  status:portsStatus,
};

