// Dashboard tab.
// Part of app.js: files in html/app/ are concatenated in filename order.
function dashChips(){
  var c=0,e=0,sr=0,st=0;
  S.ports.forEach(function(p){
    if(p.enabled&&p.link>0)c++;
    e+=Number(BigInt(p.txB)+BigInt(p.rxB));
    var r=S.rates[p.portNum-1];
    if(r){sr+=r.rx;st+=r.tx;}
  });
  $("dconn").textContent=c+"/"+S.n;
  $("dtotrx").textContent=fmtPps(sr);
  $("dtottx").textContent=fmtPps(st);
  $("derrs").textContent=String(e);
}
function dashChart(){
  var n=S.histR.length;
  if(!n)return;
  var m=1,i,x,y,step=600/119,dr="",dt="";
  for(i=0;i<n;i++){
    if(S.histR[i]>m)m=S.histR[i];
    if(S.histT[i]>m)m=S.histT[i];
  }
  for(i=0;i<n;i++){
    x=((i+120-n)*step).toFixed(1);
    y=(165-S.histR[i]/m*150).toFixed(1);
    dr+=(i?"L":"M")+x+","+y;
    y=(165-S.histT[i]/m*150).toFixed(1);
    dt+=(i?"L":"M")+x+","+y;
  }
  $("rxline").setAttribute("d",dr);
  $("txline").setAttribute("d",dt);
  $("rxarea").setAttribute("d",dr+"L600,170L"+((120-n)*step).toFixed(1)+",170Z");
  $("dnowrx").textContent=fmtPps(S.histR[n-1]);
  $("dnowtx").textContent=fmtPps(S.histT[n-1]);
}
function dashBars(){
  var up=[];
  S.ports.forEach(function(p){if(p.enabled&&p.link>0)up.push(p);});
  var sig=up.map(function(p){return p.portNum+":"+p.link}).join(",");
  if(sig!==S.pbSig){
    S.pbSig=sig;
    var bx=$("pbars");
    bx.innerHTML="";
    up.forEach(function(p){
      bx.appendChild(h("div",{class:"pbar-row"},[
        h("span",{class:"pbar-name",text:p.portNum+" · "+(p.isSFP?"SFP":LINKS[p.link])}),
        h("div",{class:"pbar-track"},[h("div",{class:"pbar-fill frx"}),h("div",{class:"pbar-fill ftx"})]),
        h("span",{class:"pbar-val",text:"-"}),
      ]));
    });
  }
  var m=1,vals=[];
  up.forEach(function(p){
    var r=S.rates[p.portNum-1],a=r?r.rx:0,b=r?r.tx:0;
    vals.push([a,b]);
    if(a>m)m=a;
    if(b>m)m=b;
  });
  var rows=$("pbars").children;
  for(var i=0;i<rows.length;i++){
    rows[i].children[1].children[0].style.width=(vals[i][0]/m*100).toFixed(2)+"%";
    rows[i].children[1].children[1].style.width=(vals[i][1]/m*100).toFixed(2)+"%";
    rows[i].children[2].textContent="RX "+fmtPps(vals[i][0])+" · TX "+fmtPps(vals[i][1]);
  }
}
function dashSfp(){
  var p=null;
  S.ports.forEach(function(q){if(!p&&q.isSFP)p=q;});
  var card=$("d_sfpcard");
  if(!p||!p.sfp_vendor){card.style.display="none";return;}
  card.style.display="";
  $("dsfpport").textContent=t("c_port")+" "+p.portNum+" · SFP+ DDM";
  var hd=$("dsfphead");
  hd.innerHTML="";
  hd.appendChild(h("span",{class:"badge ok",text:t("d_present")}));
  hd.appendChild(h("span",{class:"small mono",text:[p.sfp_vendor,p.sfp_model].filter(Boolean).join(" ")}));
  if(p.sfp_serial)hd.appendChild(h("span",{class:"small mut",text:"S/N "+p.sfp_serial,style:"margin-left:auto"}));
  var g=$("dsfpgrid");
  g.innerHTML="";
  if(!(p.sfp_options&0x40))return;
  var tx=calSO(pU16(p.sfp_txpower),p.sfp_txpower_cal)/10000;
  var rx=calRx(pU16(p.sfp_rxpower),p.sfp_rxpower_cal)/10000;
  [["p_temp",ddmFmt(calSO(pI16(p.sfp_temp),p.sfp_temp_cal)/256,1," °C")],
   ["p_vcc",ddmFmt(calSO(pU16(p.sfp_vcc),p.sfp_vcc_cal)/10000,2," V")],
   ["p_txpower",ddmFmt(dBm(tx),1," dBm")],
   ["p_rxpower",ddmFmt(dBm(rx),1," dBm")]].forEach(function(s){
    g.appendChild(h("div",{class:"sens"},[h("div",{class:"sv",text:s[1]}),h("div",{class:"sl",text:t(s[0])})]));
  });
}
function dashStatus(){
  var tb=$("traffic").tBodies[0];
  if(tb.rows.length!==S.n){
    tb.innerHTML="";
    for(var i=0;i<S.n;i++){
      var tr=tb.insertRow();
      for(var c=0;c<6;c++)tr.insertCell().className=c>=2?"num":"";
    }
  }
  S.ports.forEach(function(p){
    var r=tb.rows[p.portNum-1];
    if(!r)return;
    var rt=S.rates[p.portNum-1];
    r.cells[0].textContent=portLabel(p);
    r.cells[1].innerHTML=linkBadge(p);
    r.cells[2].textContent=rt?fmtPps(rt.tx):"-";
    r.cells[3].textContent=rt?fmtPps(rt.rx):"-";
    r.cells[4].textContent=BigInt(p.txB).toString();
    r.cells[5].textContent=BigInt(p.rxB).toString();
  });
  dashChips();
  dashChart();
  dashBars();
  dashSfp();
}
tabHooks.dash={
  enter:function(){statusPoller.start();pollInfo().catch(function(){})},
  leave:function(){statusPoller.stop()},
  status:dashStatus,
};

