"use strict";
// Dashboard tab: front panel, overview chips, the live traffic chart
// (RX/TX/error lines, span selector, crosshair), one DDM card per SFP
// module and the traffic table.
// Part of app.js: files in html/app/ are concatenated in filename order.
// HIST_MAX/HIST_DT (history size and sample period) live in 01-core.js.
function chartSpan(){return S.chartSpan||120}

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
function fmtRel(s){
  if(s<60)return s+"s";
  var m=Math.floor(s/60),r=Math.round(s%60);
  if(m<60)return r?m+"m "+r+"s":m+"m";
  return Math.floor(m/60)+"h "+(m%60)+"m";
}
function chartMax(R,T,n){
  var m=1,i;
  for(i=0;i<n;i++){
    if(R[i]>m)m=R[i];
    if(T[i]>m)m=T[i];
  }
  // Headroom so the peak does not ride on the top gridline.
  return m*1.1;
}
function dashChart(){
  var n=S.histR.length;
  if(!n)return;
  var span=chartSpan();
  if(span>n)span=n;
  var m=chartMax(S.histR,S.histT,span),i,x,y,step=600/(HIST_MAX-1),off=n-span;
  var dr="",dt="",de="";
  for(i=0;i<span;i++){
    x=((off+i)*step).toFixed(1);
    y=(165-S.histR[off+i]/m*150).toFixed(1); dr+=(i?"L":"M")+x+","+y;
    y=(165-S.histT[off+i]/m*150).toFixed(1); dt+=(i?"L":"M")+x+","+y;
    y=(165-S.histE[off+i]/m*150).toFixed(1); de+=(i?"L":"M")+x+","+y;
  }
  $("ytop").textContent=fmtPps(m);
  $("ymid").textContent=fmtPps(m/2);
  $("rxline").setAttribute("d",dr);
  $("txline").setAttribute("d",dt);
  $("errline").setAttribute("d",de);
  $("rxarea").setAttribute("d",dr+"L"+((n-1)*step).toFixed(1)+",170L"+(off*step).toFixed(1)+",170Z");
  $("txarea").setAttribute("d",dt+"L"+((n-1)*step).toFixed(1)+",170L"+(off*step).toFixed(1)+",170Z");
  $("dnowrx").textContent=fmtPps(S.histR[n-1]);
  $("dnowtx").textContent=fmtPps(S.histT[n-1]);
  $("dnowerr").textContent=fmtPps(S.histE[n-1]);
}
function chartHover(ev){
  var n=S.histR.length;
  if(!n)return;
  var span=chartSpan();
  if(span>n)span=n;
  var box=$("chartbox"),r=box.getBoundingClientRect();
  if(!r.width)return;
  var step=600/(HIST_MAX-1),startx=(n-span)*step;
  var idx=Math.round(((ev.clientX-r.left)/r.width*600-startx)/step);
  if(idx<0)idx=0;
  if(idx>span-1)idx=span-1;
  var j=n-span+idx,xv=(startx+idx*step).toFixed(1);
  var cross=$("xcross"),tip=$("charttip");
  cross.style.display="";
  cross.setAttribute("x1",xv);
  cross.setAttribute("x2",xv);
  var age=Math.round((span-1-idx)*HIST_DT);
  var rows='<div class="tt">'+(age?fmtRel(age)+" "+t("d_chart_ago"):t("d_chart_now"))+"</div>"
    +'<div><i style="background:var(--ac)"></i>RX <b>'+fmtPps(S.histR[j])+"</b></div>"
    +'<div><i style="background:var(--s5g)"></i>TX <b>'+fmtPps(S.histT[j])+"</b></div>"
    +'<div><i style="background:var(--bad)"></i>'+t("d_errs")+" <b>"+fmtPps(S.histE[j])+"</b></div>";
  tip.innerHTML=rows;
  tip.style.display="";
  var lx=(ev.clientX-r.left)+12;
  if(lx+tip.offsetWidth>r.width-2)lx=(ev.clientX-r.left)-tip.offsetWidth-12;
  tip.style.left=Math.max(0,lx)+"px";
}
function chartLeave(){
  $("xcross").style.display="none";
  $("charttip").style.display="none";
}
function dashSfp(){
  var box=$("dsfpcards");
  box.innerHTML="";
  S.ports.forEach(function(p){
    if(!p.isSFP||!p.sfp_vendor)return;
    /* not up: dim the DDM tiles, keep the "present" badge full strength */
    var up=p.enabled&&p.link>0;
    var card=h("div",{class:"card"+(up?"":" pdown")});
    var hd=h("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap"});
    hd.appendChild(h("span",{class:"badge ok",text:t("d_present")}));
    hd.appendChild(h("span",{class:"small mono",text:[p.sfp_vendor,p.sfp_model].filter(Boolean).join(" ")}));
    if(p.sfp_serial)hd.appendChild(h("span",{class:"small mut",text:"S/N "+p.sfp_serial,style:"margin-left:auto"}));
    var g=h("div",{class:"sensgrid"});
    if(p.sfp_options&0x40){
      var tx=calSO(pU16(p.sfp_txpower),p.sfp_txpower_cal)/10000;
      var rx=calRx(pU16(p.sfp_rxpower),p.sfp_rxpower_cal)/10000;
      [["p_temp",ddmFmt(calSO(pI16(p.sfp_temp),p.sfp_temp_cal)/256,1," °C")],
       ["p_vcc",ddmFmt(calSO(pU16(p.sfp_vcc),p.sfp_vcc_cal)/10000,2," V")],
       ["p_txpower",ddmFmt(dBm(tx),1," dBm")],
       ["p_rxpower",ddmFmt(dBm(rx),1," dBm")]].forEach(function(s){
        g.appendChild(h("div",{class:"sens"},[h("div",{class:"sv",text:s[1]}),h("div",{class:"sl",text:t(s[0])})]));
      });
    }
    card.appendChild(h2card(t("d_sfp"),t("c_port")+" "+p.portNum+" · SFP+ DDM"));
    card.appendChild(hd);card.appendChild(g);
    box.appendChild(card);
  });
}
function h2card(label,hint){
  var e=h("h2");
  e.appendChild(h("span",{text:label}));
  if(hint)e.appendChild(h("span",{class:"hint",text:hint}));
  return e;
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
    /* port not up: dim the numbers, keep the link badge legible */
    r.className=(p.enabled&&p.link>0)?"":"pdown";
    r.cells[0].textContent=portLabel(p);
    r.cells[1].innerHTML=linkBadge(p);
    r.cells[2].textContent=rt?fmtPps(rt.tx):"-";
    r.cells[3].textContent=rt?fmtPps(rt.rx):"-";
    r.cells[4].textContent=BigInt(p.txB).toString();
    r.cells[5].textContent=BigInt(p.rxB).toString();
    /* same error encoding as the port statistics table */
    errCell(r.cells[4],p.txB);
    errCell(r.cells[5],p.rxB);
  });
  dashChips();
  dashChart();
  dashSfp();
}
tabHooks.dash={
  enter:function(){statusPoller.start();pollInfo().catch(function(){})},
  leave:function(){statusPoller.stop();chartLeave()},
  status:dashStatus,
};
