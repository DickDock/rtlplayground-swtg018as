"use strict";
// System tab: network, services, password, console, display, startup
// configuration, firmware update and maintenance.
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
function cfgReload(){
  return getText("/config").then(function(x){
    x=x.replace(/\0[\s\S]*$/,"");
    $("cfgedit").value=x;
    cfgBytes();
    cfgParseKnown(x);
  }).catch(function(){});
}
function cfgBytes(){
  var v=$("cfgedit").value,n=new Blob([v]).size;
  var el=$("cfgbytes");
  el.textContent=n+" / 2048 "+t("sy_bytes");
  el.style.color=(n>2048||cfgLongLine(v))?"var(--bad)":"";
  return n;
}
function netApply(){
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
}
function dhcpUse(){
  confirmModal(t("sy_dhcp_q"),t("sy_dhcp_d"),function(){postCmd("ip dhcp").catch(function(){})});
}
function pwApply(){
  var a=$("sy-pw1").value,b=$("sy-pw2").value;
  if(a.length<1||a.length>20){toast(t("sy_pw_len"),"err");return;}
  if(/\s/.test(a)){toast(t("sy_pw_space"),"err");return;}
  if(a!==b){toast(t("sy_pw_match"),"err");return;}
  confirmModal(t("sy_pw_q"),t("sy_pw_d"),function(){
    postCmd("passwd "+a).then(function(){
      $("sy-pw1").value=$("sy-pw2").value="";
    }).catch(function(){});
  });
}
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
function rebootAsk(){
  confirmModal(t("sy_reboot_q"),S.dirty?t("sy_reboot_d"):"",function(){
    api("/reset").catch(function(){});
    toast(t("sy_rebooting"),"ok");
  });
}
$("sy-apply").addEventListener("click",netApply);
$("sy-dhcp").addEventListener("click",dhcpUse);
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
$("sy-pwapply").addEventListener("click",pwApply);
$("sy-send").addEventListener("click",sysConsole);
$("sy-cmd").addEventListener("keydown",function(e){if(e.key==="Enter")sysConsole()});
$("cfgedit").addEventListener("input",cfgBytes);
$("cfgreload").addEventListener("click",cfgReload);
$("cfgwrite").addEventListener("click",function(){
  writeConfig($("cfgedit").value,t("cw_title"));
});
$("sy-reboot").addEventListener("click",rebootAsk);

var fwBuf=null;
$("fwfile").addEventListener("change",function(){
  var f=this.files[0];
  fwBuf=null;
  $("fwup").disabled=true;
  $("fwinfo").textContent="";
  if(!f)return;
  var info=$("fwinfo");
  info.textContent=t("fw_checking",{f:f.name,n:f.size});
  f.arrayBuffer().then(function(buf){
    var u=new Uint8Array(buf),msg=null;
    if(u.length!==524288)msg=t("fw_size_err",{n:u.length});
    else if(u[0]!==0x00||u[1]!==0x40||u[2]!==0x02)msg=t("fw_magic_err");
    else{
      var crc=0;
      for(var i=0;i<u.length;i++){
        crc^=u[i];
        for(var b=0;b<8;b++)crc=(crc&1)?((crc>>>1)^0xA001):(crc>>>1);
      }
      if(crc!==0xB001)msg=t("fw_crc_err");
    }
    if(msg){
      info.innerHTML='<span style="color:var(--bad)">✕ '+esc(msg)+"</span>";
      return;
    }
    fwBuf=f;
    info.innerHTML='<span style="color:var(--ok)">✓ '+esc(t("fw_valid"))+"</span>";
    $("fwup").disabled=false;
  });
});
$("fwup").addEventListener("click",function(){
  if(!fwBuf)return;
  confirmModal(t("fw_q"),t("fw_d"),function(){
    var form=new FormData();
    form.append("uploadedfile",fwBuf,fwBuf.name);
    var xhr=new XMLHttpRequest();
    var prog=$("fwprog"),st=$("fwstat");
    var sent=false,settled=false,t0=Date.now(),pct=0;
    prog.style.display="";prog.value=0;
    $("fwup").disabled=true;
    function settle(fn){
      if(settled)return;
      settled=true;
      clearInterval(tick);
      prog.style.display="none";
      fn();
    }
    var tick=setInterval(function(){
      var s=Math.round((Date.now()-t0)/1000);
      st.textContent=sent?t("fw_finishing",{s:s}):t("fw_uploading",{p:pct,s:s});
    },500);
    st.textContent=t("fw_uploading",{p:0,s:0});
    xhr.upload.onprogress=function(e){
      if(e.lengthComputable){pct=Math.round(100*e.loaded/e.total);prog.value=pct;}
    };
    xhr.upload.onload=function(){
      sent=true;
      prog.removeAttribute("value");
    };
    xhr.onload=function(){settle(function(){
      if(xhr.status===200){
        st.textContent=t("fw_verified");
        fwSettle(st,true);
      }else{
        var why=(xhr.responseText||"").trim().split("\n")[0];
        st.textContent="✕ "+t("fw_rejected")+" (HTTP "+xhr.status+(why?": "+why:"")+")";
        $("fwup").disabled=false;
      }
    })};
    xhr.onerror=function(){settle(function(){
      if(!sent){st.textContent=t("fw_lost");$("fwup").disabled=false;return;}
      fwSettle(st,false);
    })};
    xhr.open("POST","/upload");
    xhr.send(form);
  });
});
/* knownGood: the firmware answered 200, so an early reply only means the
 * reset is still pending. Without a verdict an early reply means no reboot
 * happened, i.e. the image was rejected. Raw fetch: a 401 from the fresh
 * boot still counts as "the switch is back". */
function fwSettle(st,knownGood){
  var waited=3,down=false;
  function probe(){
    var ctl=("AbortController"in window)?new AbortController():null;
    var to=setTimeout(function(){if(ctl)ctl.abort()},2500);
    fetch("/information.json",{signal:ctl?ctl.signal:undefined,cache:"no-store"}).then(function(){
      clearTimeout(to);
      if(!down&&waited<=9){
        if(!knownGood){
          st.textContent="✕ "+t("fw_noreboot");
          $("fwup").disabled=false;
          return;
        }
        waited+=3;setTimeout(probe,3000);
        return;
      }
      st.textContent=t("fw_applied")+" ✓";
      modal(t("fw_done_t"),h("p",{text:t("fw_done")}),
        [h("button",{class:"ctl pri",text:t("fw_login"),onclick:function(){location.href="/login.html"}})]);
    },function(){
      clearTimeout(to);
      down=true;
      waited+=3;
      st.textContent=t("fw_rebooting");
      if(waited>150){
        st.textContent=t("fw_timeout");
        $("fwup").disabled=false;
        return;
      }
      setTimeout(probe,3000);
    });
  }
  setTimeout(probe,3000);
}
tabHooks.system={enter:sysLoad};
