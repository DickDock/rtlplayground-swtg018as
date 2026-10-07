"use strict";
// VLAN tab: list, editor, ingress filter. Also shared mask/range helpers.
// Part of app.js: files in html/app/ are concatenated in filename order.
function maskToPorts(mask){
  var out=[];
  for(var p=1;p<=S.n;p++)if((mask>>S.physToLog[p-1])&1)out.push(p);
  return out;
}
function rangeStr(list){
  if(!list.length)return"-";
  var parts=[],s=list[0],e=list[0];
  for(var i=1;i<=list.length;i++){
    if(list[i]===e+1){e=list[i];continue}
    parts.push(s===e?String(s):s+"-"+e);
    s=e=list[i];
  }
  return parts.join(", ");
}
function vlanRefresh(){
  var tb=$("vtable").tBodies[0];
  return getJSON("/vlanlist").then(function(d){
    var vl=d.vlan||[];
    $("vmgmtcur").textContent=d.mgmt?String(d.mgmt):t("v_mgmt_none");
    $("vempty").style.display=vl.length?"none":"";
    navCount("vlan",vl.length);
    tb.innerHTML="";
    var p=Promise.resolve();
    vl.forEach(function(v){
      p=p.then(function(){return getJSON("/vlan.json?vid="+v.id).catch(function(){return null})}).then(function(d){
        var tr=tb.insertRow();
        tr.insertCell().appendChild(h("a",{href:"#vlan",text:String(v.id),onclick:function(e){
          e.preventDefault();$("vvid").value=v.id;vlanLoad();
        }}));
        tr.insertCell().textContent=v.name||"";
        if(!d){for(var c=0;c<4;c++)tr.insertCell().textContent="?";}
        else{
          var m=parseInt(d.members,16),mem=m&0x3ff,unt=((m>>10)&0x3ff)&mem;
          var pv=parseInt(d.pvid,16)&0x3ff;
          tr.insertCell().textContent=rangeStr(maskToPorts(mem));
          tr.insertCell().textContent=rangeStr(maskToPorts(mem&~unt));
          tr.insertCell().textContent=rangeStr(maskToPorts(unt));
          tr.insertCell().textContent=rangeStr(maskToPorts(pv));
        }
        var del=tr.insertCell();
        if(v.id!==1)del.appendChild(h("button",{class:"ctl iconb",text:"✕","aria-label":t("v_del_t"),title:t("v_del_t"),onclick:function(){
          confirmModal(t("v_del_q",{n:v.id}),t("v_del_d"),function(){
            postCmd("vlan "+v.id+" d").then(vlanRefresh).catch(function(){});
          });
        }}));
      }).catch(function(){});
    });
    return p;
  });
}
function buildVlanEdit(){
  var tb=$("vedit").tBodies[0];
  if(tb.rows.length||!S.n)return;
  var hd=tb.insertRow();hd.insertCell().className="mut";
  var rM=tb.insertRow();rM.insertCell().className="rlab";rM.cells[0].textContent=t("v_member");
  var rP=tb.insertRow();rP.insertCell().className="rlab";rP.cells[0].textContent=t("v_pvid");
  for(var p=1;p<=S.n;p++)(function(p){
    var hc=hd.insertCell();hc.className="vh";hc.innerHTML="<b>"+p+"</b>";
    var seg=h("span",{class:"seg",id:"vm"+p});
    ["-","U","T"].forEach(function(s,ix){
      seg.appendChild(h("button",{text:s,"data-v":ix,onclick:function(){
        seg.querySelectorAll("button").forEach(function(b){b.classList.remove("on")});
        this.classList.add("on");
      }}));
    });
    seg.children[0].classList.add("on");
    rM.insertCell().appendChild(seg);
    rP.insertCell().appendChild(h("input",{type:"checkbox",id:"vp"+p}));
  })(p);
  var it=$("ingress").tBodies[0];
  var ih=it.insertRow();ih.insertCell().className="mut";
  var ir=it.insertRow();ir.insertCell().className="rlab";ir.cells[0].textContent=t("v_accept");
  for(var q=1;q<=S.n;q++)(function(q){
    var hc=ih.insertCell();hc.className="vh";hc.innerHTML="<b>"+q+"</b>";
    var sel=h("select",{class:"in",id:"ing"+q});
    [["","-"],["a",t("v_ing_all")],["u",t("v_untagged")],["t",t("v_tagged")]].forEach(function(o){
      sel.appendChild(h("option",{value:o[0],text:o[1]}));
    });
    ir.insertCell().appendChild(sel);
  })(q);
}
function segVal(p){
  return Number($("vm"+p).querySelector("button.on").getAttribute("data-v"));
}
function segSet(p,v){
  $("vm"+p).querySelectorAll("button").forEach(function(b,i){b.classList.toggle("on",i===v)});
}
function vlanLoad(){
  var vid=parseInt($("vvid").value,10);
  if(!vid||vid<1||vid>4094){toast(t("v_vid_err"),"err");return;}
  getJSON("/vlan.json?vid="+vid).then(function(d){
    $("vname").value=d.name||"";
    var m=parseInt(d.members,16),mem=m&0x3ff,unt=((m>>10)&0x3ff)&mem;
    var pv=parseInt(d.pvid,16)&0x3ff;
    for(var p=1;p<=S.n;p++){
      var bit=S.physToLog[p-1];
      segSet(p,(mem>>bit)&1?(((unt>>bit)&1)?1:2):0);
      $("vp"+p).checked=!!((pv>>bit)&1);
    }
    toast(t("v_loaded",{n:vid}),"ok");
  }).catch(function(){toast(t("v_notfound",{n:vid}),"err")});
}
function vlanApply(){
  var vid=parseInt($("vvid").value,10);
  if(!vid||vid<1||vid>4094){toast(t("v_vid_err"),"err");return;}
  var name=$("vname").value.trim();
  if(name&&!/^[a-zA-Z]\w*$/.test(name)){toast(t("v_name_err"),"err");return;}
  var cmd="vlan "+vid+(name?" "+name:""),members=0;
  for(var p=1;p<=S.n;p++){
    var v=segVal(p);
    if(v===1){cmd+=" "+p;members++;}
    else if(v===2){cmd+=" "+p+"t";members++;}
  }
  if(!members){toast(t("v_nomember"),"err");return;}
  var cmds=[cmd];
  for(var q=1;q<=S.n;q++)if($("vp"+q).checked)cmds.push("pvid "+q+" "+vid);
  postCmds(cmds).then(vlanRefresh).catch(function(){});
}
function ingressApply(){
  var cmd="ingress",any=false;
  for(var p=1;p<=S.n;p++){
    var v=$("ing"+p).value;
    if(v){cmd+=" "+p+v;any=true;}
  }
  if(!any){toast(t("v_ing_none"),"err");return;}
  postCmd(cmd).catch(function(){});
}
function vlanMgmt(){
  var vid=parseInt($("vvid").value,10);
  if(!vid){toast(t("v_vid_first"),"err");return;}
  confirmModal(t("v_mgmt_q",{n:vid}),t("v_mgmt_d"),
    function(){postCmd("vlan "+vid+" mgmt").then(vlanRefresh).catch(function(){})});
}
tabHooks.vlan={
  enter:function(){needPorts(function(){buildVlanEdit();vlanRefresh().catch(function(){})})},
};
$("vload").addEventListener("click",vlanLoad);
$("vapply").addEventListener("click",vlanApply);
$("ingapply").addEventListener("click",ingressApply);
$("vmgmt").addEventListener("click",vlanMgmt);
