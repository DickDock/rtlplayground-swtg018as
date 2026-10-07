"use strict";
// Traffic control tab: bandwidth limits, storm control, port mirroring.
// Part of app.js: files in html/app/ are concatenated in filename order.
function bwLoad(){
  return getJSON("/bandwidth.json").then(function(s){
    var tb=$("btable").tBodies[0];tb.innerHTML="";
    byPort(s).forEach(function(p){
      var n=p.portNum;
      var iOn=!!Number(p.iLimited),eOn=!!Number(p.eLimited);
      var iM=(parseInt(p.iBW,16)*16/1000),eM=(parseInt(p.eBW,16)*16/1000);
      var tr=tb.insertRow();
      tr.insertCell().textContent=n;
      var icb=h("input",{type:"checkbox",id:"bwi"+n});icb.checked=iOn;
      tr.insertCell().appendChild(icb);
      var iin=h("input",{class:"in sm",id:"bwiv"+n,type:"number",min:"0.016",max:"10000",step:"any"});
      if(iOn)iin.value=+iM.toFixed(3);
      tr.insertCell().appendChild(iin);
      var msel=h("select",{class:"in",id:"bwm"+n},[
        h("option",{value:"fc",text:t("bw_fc")}),
        h("option",{value:"drop",text:t("bw_drop")}),
      ]);
      msel.value=Number(p.iFC)===1?"fc":"drop";
      tr.insertCell().appendChild(msel);
      var ecb=h("input",{type:"checkbox",id:"bwe"+n});ecb.checked=eOn;
      tr.insertCell().appendChild(ecb);
      var ein=h("input",{class:"in sm",id:"bwev"+n,type:"number",min:"0.016",max:"10000",step:"any"});
      if(eOn)ein.value=+eM.toFixed(3);
      tr.insertCell().appendChild(ein);
      var iup=function(){$("bwiv"+n).disabled=!icb.checked;$("bwm"+n).disabled=!icb.checked};
      var eup=function(){$("bwev"+n).disabled=!ecb.checked};
      icb.addEventListener("change",iup);ecb.addEventListener("change",eup);
      iup();eup();
      tr.insertCell().appendChild(h("button",{class:"ctl",text:t("c_apply"),onclick:function(){bwApply(n)}}));
    });
  });
}
/* The bw command takes kbit/s and converts to 16-kbit register steps itself. */
function bwHex(mbit){
  var kbit=Math.round(mbit*1000);
  if(kbit<16||kbit>10000000)return null;
  var x=kbit.toString(16);
  return x.length%2?"0"+x:x;
}
function bwApply(n){
  var cmds=[];
  if($("bwi"+n).checked){
    var ih=bwHex(parseFloat($("bwiv"+n).value));
    if(!ih){toast(t("bw_in_err"),"err");return;}
    cmds.push("bw in "+n+" "+ih);
    cmds.push("bw in "+n+" "+$("bwm"+n).value);
  }else cmds.push("bw in "+n+" off");
  if($("bwe"+n).checked){
    var eh=bwHex(parseFloat($("bwev"+n).value));
    if(!eh){toast(t("bw_out_err"),"err");return;}
    cmds.push("bw out "+n+" "+eh);
  }else cmds.push("bw out "+n+" off");
  postCmds(cmds).then(bwLoad).catch(function(){});
}
var SC_TYPES=["bcast","mcast","ucast","umcast"],scSig="";
function scLoad(){
  return getJSON("/storm.json").then(function(s){
    var tb=$("sctable").tBodies[0];
    byPort(s);
    var sig=s.map(function(p){return p.portNum}).join();
    if(sig!==scSig){
      scSig=sig;tb.innerHTML="";
      s.forEach(function(p){
        var n=p.portNum,tr=tb.insertRow();
        tr.id="scr"+n;
        tr.addEventListener("input",function(){tr.dataset.dirty="1"});
        tr.addEventListener("change",function(){tr.dataset.dirty="1"});
        tr.insertCell().textContent=n;
        SC_TYPES.forEach(function(ty){
          tr.insertCell().appendChild(h("span",{style:"display:flex;gap:4px"},[
            h("input",{class:"in sm",id:"scv"+ty+n,type:"number",min:"1",step:"1",placeholder:"pps"}),
            h("select",{class:"in",id:"scu"+ty+n},[
              h("option",{value:"pps",text:"pps"}),
              h("option",{value:"kbps",text:"kbit/s"}),
            ]),
          ]));
        });
        tr.insertCell().appendChild(h("button",{class:"ctl",text:t("c_apply"),onclick:function(){scApply(n)}}));
      });
    }
    s.forEach(function(p){
      var n=p.portNum;
      if($("scr"+n).dataset.dirty)return;
      SC_TYPES.forEach(function(ty,k){
        var on=p.en.charAt(k)==="1",pps=p.pps.charAt(k)==="1",raw=parseInt(p.rate.substr(k*6,6),16);
        var inp=$("scv"+ty+n),sel=$("scu"+ty+n);
        inp.value=on?raw:"";
        sel.value=on&&!pps?"kbps":"pps";
        inp.dataset.cur=on?inp.value+" "+sel.value:"off";
      });
    });
  });
}
function scApply(n){
  var cmds=[];
  for(var k=0;k<SC_TYPES.length;k++){
    var ty=SC_TYPES[k],inp=$("scv"+ty+n),u=$("scu"+ty+n).value,v=inp.value.trim(),want="off";
    if(v!==""&&v!=="0"){
      var x=Number(v);
      if(!Number.isInteger(x)||x<1||(u==="pps"&&x>1048575)||(u==="kbps"&&x>10000000)){toast(t("sc_err"),"err");return;}
      want=x+" "+u;
    }
    if(want!==inp.dataset.cur)cmds.push("storm "+n+" "+ty+" "+want);
  }
  delete $("scr"+n).dataset.dirty;
  if(!cmds.length)return;
  postCmds(cmds).then(scLoad).catch(function(){});
}

function buildMirror(){
  var sel=$("mport");
  if(sel.options.length)return;
  for(var p=1;p<=S.n;p++)sel.appendChild(h("option",{value:p,text:t("c_port")+" "+p}));
  var tb=$("mtable").tBodies[0];
  var hd=tb.insertRow();hd.insertCell().className="mut";
  var r=tb.insertRow();r.insertCell().textContent=t("m_mirror");
  for(var q=1;q<=S.n;q++)(function(q){
    hd.insertCell().innerHTML="<b>"+q+"</b>";
    var seg=h("span",{class:"seg",id:"mm"+q});
    ["-","RX","TX",t("m_both")].forEach(function(s,ix){
      seg.appendChild(h("button",{text:s,"data-v":ix,onclick:function(){
        seg.querySelectorAll("button").forEach(function(b){b.classList.remove("on")});
        this.classList.add("on");
      }}));
    });
    seg.children[0].classList.add("on");
    r.insertCell().appendChild(seg);
  })(q);
}
function mirrorLoad(){
  return getJSON("/mirror.json").then(function(m){
    $("mstate").textContent=t(m.enabled?"m_active":"c_off");
    $("mstate").className="badge "+(m.enabled?"ok":"");
    if(m.enabled)$("mport").value=m.mPort;
    var tx=parseInt(m.mirror_tx,2),rx=parseInt(m.mirror_rx,2);
    for(var p=1;p<=S.n;p++){
      var bit=S.physToLog[p-1];
      var v=(((rx>>bit)&1)?1:0)+(((tx>>bit)&1)?2:0);
      $("mm"+p).querySelectorAll("button").forEach(function(b,i){b.classList.toggle("on",i===v)});
    }
  });
}
function mirrorApply(){
  var mp=$("mport").value,cmd="mirror "+mp,any=false;
  for(var p=1;p<=S.n;p++){
    if(String(p)===mp)continue;
    var v=Number($("mm"+p).querySelector("button.on").getAttribute("data-v"));
    if(v===1){cmd+=" "+p+"r";any=true;}
    else if(v===2){cmd+=" "+p+"t";any=true;}
    else if(v===3){cmd+=" "+p;any=true;}
  }
  if(!any){toast(t("m_none"),"err");return;}
  postCmd(cmd).then(mirrorLoad).catch(function(){});
}
function mirrorOff(){
  postCmd("mirror off").then(mirrorLoad).catch(function(){});
}
$("mapply").addEventListener("click",mirrorApply);
$("moff").addEventListener("click",mirrorOff);
tabHooks.flows={
  enter:function(){
    needPorts(function(){
      bwLoad().then(scLoad).catch(function(){});
      buildMirror();mirrorLoad().catch(function(){});
    });
  },
};
