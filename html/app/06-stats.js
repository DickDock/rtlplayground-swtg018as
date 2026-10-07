// Statistics tab: per-port counters and the MIB detail modal.
// Part of app.js: files in html/app/ are concatenated in filename order.
var MIB=[
  "Interface in Octets",8,"",0,"Interface out Octets",8,"",0,
  "Interface in Unicast Pkts",8,"",0,"Interface in Multicast Pkts",8,"",0,
  "Interface in Broadcast Pkts",8,"",0,"Interface out Unicast Pkts",8,"",0,
  "Interface out Multicast Pkts",8,"",0,"Interface out Broadcast Pkts",8,"",0,
  "Interface out discards",4,"802.1d Tp Port in discards",4,
  "802.3 Single collision frames",4,"802.3 Multi collision frames",4,
  "802.3 Deferred transmissions",4,"802.3 Late collisions",4,
  "802.3 Excessive collisions",4,"802.3 Symbol errors",4,
  "802.3 Control in unknown opcodes",4,"802.3 In Pause frames",4,
  "802.3 Out Pause frames",4,"Ether drop events",4,
  "TX Ether Broadcast Pkts",4,"TX Ether Multicast Pkts",4,
  "TX Ether CRC Align errors",4,"RX Ether CRC Align errors",4,
  "TX Ether Undersized Pkts",4,"RX Ether Undersized Pkts",4,
  "TX Ether Oversized Pkts",4,"RX Ether Oversized Pkts",4,
  "TX Ether Fragments",4,"RX Ether fragments",4,
  "TX Ether Jabbers",4,"RX Ether Jabbers",4,
  "TX Ether Collisions",4,"TX Ether Pkts 64 Octets",4,"RX Ether Pkts 64 Octets",4,
  "TX Ether 65-127 Octets",4,"RX Ether 65-127 Octets",4,
  "TX Ether Pkts 128-255 Octets",4,"RX Ether Pkts 128-255 Octets",4,
  "TX Ether Pkts 256-511 Octets",4,"RX Ether Pkts 256-511 Octets",4,
  "TX Ether Pkts 512-1023 Octets",4,"RX Ether Pkts 512-1023 Octets",4,
  "TX Ether Pkts 1024-1518 Octets",4,"RX Ether Pkts 1024-1518 Octets",4,
  "",4,"RX Ether Undersized Drop Pkts",4,
  "TX Ether Pkts >1518 Octets",4,"RX Ether Pkts >1518 Octets",4,
  "TX Ether Pkts too large",4,"RX Ether Pkts too large",4,
  "TX Ether Flexible Octets Set 1",4,"RX Ether Flexible Octets Set 1",4,
  "TX Ether Flexible Octets CRC Set 1",4,"RX Ether Flexible Octets CRC Set 1",4,
  "TX Ether Flexible Octets Set 0",4,"RX Ether Flexible Octets Set 0",4,
  "TX Ether Flexible Octets CRC Set 0",4,"RX Ether Flexible Octets CRC Set 0",4,
  "Length Field Errors",4,"False Carriers",4,"Undersized Octets",4,"Framing Errors",4,
  "",4,"RX MAC Discards",4,"RX MAC IPG Short Drop",4,"",4,
  "802.1d TP Learned Entry Discards",4,
  "Egress Queue 7 Dropped Pkts",4,"Egress Queue 6 Dropped Pkts",4,
  "Egress Queue 5 Dropped Pkts",4,"Egress Queue 4 Dropped Pkts",4,
  "Egress Queue 3 Dropped Pkts",4,"Egress Queue 2 Dropped Pkts",4,
  "Egress Queue 1 Dropped Pkts",4,"Egress Queue 0 Dropped Pkts",4,
  "Egress Queue 7 Out Pkts",4,"Egress Queue 6 Out Pkts",4,
  "Egress Queue 5 Out Pkts",4,"Egress Queue 4 Out Pkts",4,
  "Egress Queue 3 Out Pkts",4,"Egress Queue 2 Out Pkts",4,
  "Egress Queue 1 Out Pkts",4,"Egress Queue 0 Out Pkts",4,
  "TX Good Counter",8,"",0,"RX Good Counter",8,"",0,
  "RX Error Counter",4,"TX Error Counter",4,
  "TX Good Counter PHY",8,"",0,"RX Good Counter PHY",8,"",0,
  "RX Error Counter PHY",4,"TX Error Counter PHY",4,
];
/* counters.json returns 64-bit hex words; two 32-bit counters share one word */
function decodeCounters(s){
  var out=[];
  for(var i=0;i<MIB.length;i+=4){
    if(MIB[i]===""&&MIB[i+1]===8)continue;
    var w=BigInt(s[i/4]||"0x0");
    if(MIB[i+1]===8)out.push([MIB[i],w]);
    else{
      if(MIB[i]!=="")out.push([MIB[i],w>>32n]);
      if(MIB[i+2]!=="")out.push([MIB[i+2],w&4294967295n]);
    }
  }
  return out;
}
var ctrPoll=null;
function showCounters(i){
  var body=h("div");
  var bar=h("div",{style:"display:flex;gap:12px;align-items:center;margin-bottom:10px"});
  var nz=h("input",{type:"checkbox",checked:""});
  var auto=h("input",{type:"checkbox"});
  bar.appendChild(h("label",null,[nz,document.createTextNode(" "+t("st_nonzero"))]));
  bar.appendChild(h("label",null,[auto,document.createTextNode(" "+t("st_autoref"))]));
  var wrap=h("div",{class:"scrollx"});
  body.appendChild(bar);body.appendChild(wrap);
  function load(){
    if(ctrPoll!==poll)return Promise.resolve();
    return getJSON("/counters.json?port="+(i+1)).then(function(s){
      if(ctrPoll!==poll)return;
      var rows=decodeCounters(s);
      var tb=h("table",{class:"t"});
      tb.appendChild(h("tr",null,[h("th",{text:t("st_counter")}),h("th",{class:"num",text:t("st_value")})]));
      rows.forEach(function(r){
        if(nz.checked&&r[1]===0n)return;
        tb.appendChild(h("tr",null,[h("td",{text:r[0]}),h("td",{class:"num mono",text:r[1].toString()})]));
      });
      wrap.innerHTML="";wrap.appendChild(tb);
    });
  }
  nz.addEventListener("change",load);
  var poll=new Poller(function(){return auto.checked?load():Promise.resolve()},2500);
  // modal 先清理旧 owner，再注册并启动此实例，不能通过全局引用误停新实例。
  modal(t("c_port")+" "+(i+1)+": "+t("st_counters"),body,
    [h("button",{class:"ctl",text:t("c_refresh"),onclick:function(){load()}}),
     h("button",{class:"ctl pri",text:t("c_close"),onclick:closeModal})],
    function(){poll.stop();if(ctrPoll===poll)ctrPoll=null});
  ctrPoll=poll;poll.start();
  load().catch(function(){if(ctrPoll===poll)wrap.textContent=t("st_fail")});
}
function statsStatus(){
  var tb=$("stable").tBodies[0];
  if(tb.rows.length!==S.n){
    tb.innerHTML="";
    for(var i=0;i<S.n;i++)(function(i){
      var tr=tb.insertRow();
      for(var c=0;c<7;c++)tr.insertCell().className=c>=3?"num":"";
      tr.insertCell().appendChild(h("button",{class:"ctl",text:t("st_details"),onclick:function(){showCounters(i)}}));
    })(i);
  }
  S.ports.forEach(function(p){
    var r=tb.rows[p.portNum-1];
    if(!r)return;
    r.cells[0].textContent=p.portNum;
    r.cells[1].textContent=p.name||"";
    r.cells[2].innerHTML=linkBadge(p);
    r.cells[3].textContent=BigInt(p.txG).toString();
    r.cells[4].textContent=BigInt(p.txB).toString();
    r.cells[5].textContent=BigInt(p.rxG).toString();
    r.cells[6].textContent=BigInt(p.rxB).toString();
  });
}
tabHooks.stats={
  enter:function(){statusPoller.start()},
  leave:function(){statusPoller.stop()},
  status:statsStatus,
};

