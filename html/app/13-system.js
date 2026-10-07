// System tab: network, services, password, console, startup config.
// Part of app.js: files in html/app/ are concatenated in filename order.
var IPRE=/^(\d{1,3}\.){3}\d{1,3}$/;
function okIp(s){
  if(!IPRE.test(s))return false;
  return s.split(".").every(function(o){return+o<=255});
}
function sysLoad(){
  pollInfo().then(function(){
    $("sy-ip").value=S.info.ip_address||"";
    $("sy-mask").value=S.info.ip_netmask||"";
    $("sy-gw").value=S.info.ip_gateway||"";
    $("sy-host").value=S.info.hostname||"";
    var sl=(S.info.syslog_server||"").split(":");
    if(sl[0]&&sl[0]!=="0.0.0.0")$("sy-sysip").value=sl[0];
    if(sl[1])$("sy-sysport").value=sl[1];
    if(S.info.session_timeout)$("sy-sesstmo").value=S.info.session_timeout;
  }).catch(function(){});
  cfgReload();
}
function cfgParseKnown(txt){
  var igmp=false,syslog=false;
  txt.split(/\r?\n/).forEach(function(l){
    l=l.trim();
    if(/^igmp on$/.test(l))igmp=true;
    if(/^igmp off$/.test(l))igmp=false;
    if(/^syslog on$/.test(l))syslog=true;
    if(/^syslog off$/.test(l))syslog=false;
  });
  $("sy-igmp").checked=igmp;
  $("sy-syslog").checked=syslog;
}
$("sy-apply").addEventListener("click",function(){
  var ip=$("sy-ip").value.trim(),mask=$("sy-mask").value.trim(),gw=$("sy-gw").value.trim();
  if(!okIp(ip)||!okIp(mask)||!okIp(gw)){toast(t("sy_ip_err"),"err");return;}
  var cmds=[];
  var hn=$("sy-host").value.trim();
  if(hn&&hn!==S.info.hostname){
    if(!/^[\x21-\x7e]{1,23}$/.test(hn)||/["\\]/.test(hn)){toast(t("sy_host_err"),"err");return;}
    cmds.push("hostname "+hn);
  }
  cmds.push("ip "+ip+"\nnetmask "+mask+"\ngw "+gw);
  var changingIp=ip!==S.info.ip_address;
  confirmModal(t("sy_net_q"),changingIp?t("sy_net_d",{ip:ip}):"",function(){
    postCmds(cmds).then(function(){
      if(changingIp)toast(t("sy_ip_changed",{ip:ip}),"ok");
      else sysLoad();
    }).catch(function(){});
  });
});
$("sy-dhcp").addEventListener("click",function(){
  confirmModal(t("sy_dhcp_q"),t("sy_dhcp_d"),function(){postCmd("ip dhcp").catch(function(){})});
});
$("sy-igmp").addEventListener("change",function(){
  var el=this;
  postCmd("igmp "+(el.checked?"on":"off")).catch(function(){el.checked=!el.checked});
});
$("sy-syslog").addEventListener("change",function(){
  var cmds=[],el=this;
  if(el.checked){
    var sip=$("sy-sysip").value.trim(),sp=$("sy-sysport").value.trim();
    if(sip&&!okIp(sip)){toast(t("sy_sysip_err"),"err");el.checked=false;return;}
    if(sp&&!(+sp>=1&&+sp<=65535)){toast(t("sy_sysport_err"),"err");el.checked=false;return;}
    if(sip)cmds.push("syslog ip "+sip);
    if(sp)cmds.push("syslog port "+sp);
    cmds.push("syslog on");
  }else cmds.push("syslog off");
  postCmds(cmds).catch(function(){});
});
$("sy-sesstmo").addEventListener("change",function(){
  var v=+this.value;
  if(!(v>=1&&v<=65535)){toast(t("sy_sesstmo_err"),"err");sysLoad();return;}
  postCmd("session "+v).catch(function(){sysLoad()});
});
$("sy-pwapply").addEventListener("click",function(){
  var a=$("sy-pw1").value,b=$("sy-pw2").value;
  if(a.length<1||a.length>20){toast(t("sy_pw_len"),"err");return;}
  if(/\s/.test(a)){toast(t("sy_pw_space"),"err");return;}
  if(a!==b){toast(t("sy_pw_match"),"err");return;}
  confirmModal(t("sy_pw_q"),t("sy_pw_d"),function(){
    postCmd("passwd "+a).then(function(){
      $("sy-pw1").value=$("sy-pw2").value="";
    }).catch(function(){});
  });
});
$("sy-send").addEventListener("click",sysConsole);
$("sy-cmd").addEventListener("keydown",function(e){if(e.key==="Enter")sysConsole()});
function sysConsole(){
  var c=$("sy-cmd").value.trim();
  if(!c)return;
  var out=$("sy-cout");
  api("/cmd",{method:"POST",body:c}).then(function(r){
    var body=r.body.replace(/\s+$/,"");
    out.textContent+="> "+c+"\n";
    if(body)out.textContent+=body+"\n";
    else out.textContent+=(r.ok?"OK":"ERROR "+r.status)+"\n";
    if(out.textContent.length>20000)out.textContent=out.textContent.slice(-16000);
    out.scrollTop=out.scrollHeight;
    if(r.ok&&isConfCmd(c))setDirty(true);
  }).catch(function(e){out.textContent+="> "+c+"\n"+e+"\n"});
  $("sy-cmd").value="";
}
$("sy-reboot").addEventListener("click",function(){
  confirmModal(t("sy_reboot_q"),S.dirty?t("sy_reboot_d"):"",function(){
    api("/reset").catch(function(){});
    toast(t("sy_rebooting"),"ok");
  });
});
function cfgReload(){
  return getText("/config").then(function(x){
    x=x.replace(/\0[\s\S]*$/,"");
    $("cfgedit").value=x;
    cfgBytes();
    cfgParseKnown(x);
  }).catch(function(){});
}
function cfgLongLine(v){
  var ls=v.split("\n");
  for(var i=0;i<ls.length;i++){var n=new Blob([ls[i]]).size;if(n>126)return{n:i+1,m:n};}
  return null;
}
function cfgBytes(){
  var v=$("cfgedit").value,n=new Blob([v]).size;
  var el=$("cfgbytes");
  el.textContent=n+" / 2048 "+t("sy_bytes");
  el.style.color=(n>2048||cfgLongLine(v))?"var(--bad)":"";
  return n;
}
$("cfgedit").addEventListener("input",cfgBytes);
$("cfgreload").addEventListener("click",cfgReload);
$("cfgwrite").addEventListener("click",function(){
  writeConfig($("cfgedit").value,t("cw_title"));
});
tabHooks.system={enter:sysLoad};

