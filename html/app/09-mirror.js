// Port mirroring tab.
// Part of app.js: files in html/app/ are concatenated in filename order.
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
$("mapply").addEventListener("click",function(){
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
});
$("moff").addEventListener("click",function(){
  postCmd("mirror off").then(mirrorLoad).catch(function(){});
});
tabHooks.mirror={enter:function(){needPorts(function(){buildMirror();mirrorLoad().catch(function(){})})}};

