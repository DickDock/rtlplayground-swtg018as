// MAC address table tab.
// Part of app.js: files in html/app/ are concatenated in filename order.
var l2Rows=[],l2SortCol="pport",l2SortDir=1,l2Gen=0;
function l2Load(){
  var seen={},all=[],idx=0,guard=0,gen=++l2Gen;
  function step(){
    return getJSON("/l2.json?idx="+idx).then(function(s){
      if(gen!==l2Gen)throw new Error("stale");
      if(!s.length)return all;
      var wrapped=false;
      s.forEach(function(e){
        e.idx=parseInt(e.idx,16);
        if(seen[e.idx]){wrapped=true;return;}
        seen[e.idx]=1;
        e.vlan=parseInt(e.vlan,16);
        e.stat=e.type==="s";
        e.pport=e.port===9?"CPU":S.logToPhys[e.port];
        e.where=e.lag?"LAG"+e.lag:String(e.pport);
        all.push(e);
      });
      if(wrapped||++guard>140)return all;
      idx=s[s.length-1].idx+1;
      return step();
    });
  }
  return step();
}
function l2Key(e){
  if(l2SortCol==="pport"){
    if(e.pport==="CPU")return 1e6;
    return e.lag?1000+e.lag:Number(e.pport);
  }
  if(l2SortCol==="vlan")return e.vlan;
  if(l2SortCol==="stat")return e.stat?1:0;
  return e.mac;
}
function l2Fetch(){
  $("l2count").textContent=t("l2_loading");
  return l2Load().then(function(all){
    l2Rows=all;
    l2Render();
  }).catch(function(e){if(e.message!=="stale")$("l2count").textContent=t("l2_failed")});
}
function l2Render(){
  var f=$("l2filter").value.toLowerCase();
  var tb=$("l2table").tBodies[0];tb.innerHTML="";
  var rows=l2Rows.slice().sort(function(a,b){
    var x=l2Key(a),y=l2Key(b);
    return((x>y)-(x<y))*l2SortDir||((a.mac>b.mac)-(a.mac<b.mac));
  });
  $("l2table").querySelectorAll("th[data-sort]").forEach(function(th){
    th.querySelector(".arrow").textContent=th.dataset.sort===l2SortCol?(l2SortDir>0?" \u25b2":" \u25bc"):"";
  });
  var shown=0;
  rows.forEach(function(e){
    var ty=t(e.stat?"l2_static":"l2_learned");
    var hay=(e.mac+" "+e.vlan+" "+e.where+" "+ty).toLowerCase();
    if(f&&hay.indexOf(f)<0)return;
    shown++;
    var tr=tb.insertRow();
    tr.insertCell().textContent=e.where;
    tr.insertCell().className="mono";tr.cells[1].textContent=e.mac;
    tr.insertCell().textContent=e.vlan;
    tr.insertCell().textContent=ty;
    var dc=tr.insertCell();
    if(e.pport!=="CPU")dc.appendChild(h("button",{class:"ctl",text:"\u2715",title:t("l2_del_t"),onclick:function(){
      getJSON("/l2_del.json?idx="+e.idx).then(function(){
        l2Rows=l2Rows.filter(function(x){return x!==e});
        l2Render();
      }).catch(function(){});
    }}));
  });
  $("l2count").textContent=shown+" / "+l2Rows.length+" "+t("l2_entries");
}
$("l2table").querySelectorAll("th[data-sort]").forEach(function(th){
  th.addEventListener("click",function(){
    var c=th.dataset.sort;
    l2SortDir=(c===l2SortCol)?-l2SortDir:1;
    l2SortCol=c;
    l2Render();
  });
});
$("l2filter").addEventListener("input",l2Render);
$("l2refresh").addEventListener("click",function(){l2Fetch()});
$("l2flush").addEventListener("click",function(){
  confirmModal(t("l2_flush_q"),"",function(){
    postCmd("l2 forget").then(function(){setTimeout(l2Fetch,500)}).catch(function(){});
  });
});
tabHooks.l2={enter:function(){needPorts(function(){l2Fetch()})},leave:function(){l2Gen++}};

