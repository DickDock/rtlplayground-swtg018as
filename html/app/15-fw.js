// Firmware upload tab and the boot sequence.
// Part of app.js: files in html/app/ are concatenated in filename order.
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
      info.innerHTML='<span style="color:var(--bad)">\u2715 '+esc(msg)+"</span>";
      return;
    }
    fwBuf=f;
    info.innerHTML='<span style="color:var(--ok)">\u2713 '+esc(t("fw_valid"))+"</span>";
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
        st.textContent="\u2715 "+t("fw_rejected")+" (HTTP "+xhr.status+(why?": "+why:"")+")";
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
          st.textContent="\u2715 "+t("fw_noreboot");
          $("fwup").disabled=false;
          return;
        }
        waited+=3;setTimeout(probe,3000);
        return;
      }
      st.textContent=t("fw_applied")+" \u2713";
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
tabHooks.fw={};

window.addEventListener("hashchange",function(){
  var id=location.hash.slice(1);
  if(TABS.some(function(tb){return tb.id===id})&&id!==curTab)showTab(id);
});
(function(){
  var id=location.hash.slice(1);
  if(!TABS.some(function(tb){return tb.id===id}))id="dash";
  pollInfo().catch(function(){});
  getText("/cmd_log").then(function(x){
    x=x.replace(/\0[\s\S]*$/,"").trim();
    if(x&&x.split(/\r?\n/).some(function(l){return isConfCmd(l.trim())}))setDirty(true);
  }).catch(function(){});
  showTab(id);
})();
