"use strict";
// SFP DOMD value decoding: raw hex fields to physical units, and the
// per-port detail table.
// Part of app.js: files in html/app/ are concatenated in filename order.
// 读取失败可能只返回 "0x"，不能用位运算把 NaN 变成有效零读数。
function pU16(v){return /^(0x)?[0-9a-f]{1,4}$/i.test(v)?parseInt(v,16):NaN}
function pI16(v){var x=pU16(v);return x>=0x8000?x-0x10000:x}
function ddmFmt(v,n,unit){return isFinite(v)?v.toFixed(n)+unit:"-"}
function calSO(val,cal){
  if(typeof cal!=="string")return val;
  if(cal.slice(0,2)==="0x")cal=cal.slice(2);
  if(!/^[0-9a-f]{8}$/i.test(cal))return NaN;
  return(pU16(cal.slice(0,4))/256)*val+pI16(cal.slice(4,8));
}
function calRx(val,cal){
  if(typeof cal!=="string")return val;
  if(cal.slice(0,2)==="0x")cal=cal.slice(2);
  if(!/^[0-9a-f]{40}$/i.test(cal))return NaN;
  var b=cal.match(/.{2}/g).map(function(x){return parseInt(x,16)});
  var v=new DataView(new Uint8Array(b).buffer);
  return v.getFloat32(0)*Math.pow(val,4)+v.getFloat32(4)*Math.pow(val,3)
    +v.getFloat32(8)*Math.pow(val,2)+v.getFloat32(12)*val+v.getFloat32(16);
}
function dBm(mw){return 10*Math.log10(Math.max(mw,1e-4))}
function portRows(p){
  var rows=[[t("c_port"),String(p.portNum)],[t("c_type"),p.isSFP?"SFP":"RJ45"]];
  if(p.name)rows.push([t("c_name"),p.name]);
  rows.push([t("p_state"),!p.enabled?t("p_disabled"):(p.link>0?t("p_up")+" "+LINKS[p.link]:t("c_down"))]);
  rows.push([t("p_txgb"),BigInt(p.txG)+" / "+BigInt(p.txB)+" "+t("p_pkts")]);
  rows.push([t("p_rxgb"),BigInt(p.rxG)+" / "+BigInt(p.rxB)+" "+t("p_pkts")]);
  if(p.isSFP){
    if(p.sfp_vendor)rows.push([t("p_module"),[p.sfp_vendor,p.sfp_model,p.sfp_serial].filter(Boolean).join(" / ")]);
    var ext=p.sfp_options&0x40,state=pU16(p.sfp_state);
    if(ext){
      var tx=calSO(pU16(p.sfp_txpower),p.sfp_txpower_cal)/10000;
      var rx=calRx(pU16(p.sfp_rxpower),p.sfp_rxpower_cal)/10000;
      rows.push([t("p_temp"),ddmFmt(calSO(pI16(p.sfp_temp),p.sfp_temp_cal)/256,1," °C")]);
      rows.push([t("p_vcc"),ddmFmt(calSO(pU16(p.sfp_vcc),p.sfp_vcc_cal)/10000,2," V")]);
      rows.push([t("p_txbias"),ddmFmt(calSO(pU16(p.sfp_txbias),p.sfp_txbias_cal)/500,1," mA")]);
      rows.push([t("p_txpower"),isFinite(tx)?ddmFmt(tx,3," mW / ")+ddmFmt(dBm(tx),2," dBm"):"-"]);
      rows.push([t("p_rxpower"),isFinite(rx)?ddmFmt(rx,3," mW / ")+ddmFmt(dBm(rx),2," dBm"):"-"]);
      rows.push([t("p_txfault"),isFinite(state)?t((state&0x4)?"c_yes":"c_no"):"-"]);
      rows.push([t("p_txdis"),isFinite(state)?t((state&0x80)?"c_yes":"c_no"):"-"]);
    }
    var losPin=(p.sfp_los!=null)?!!Number(p.sfp_los):null;
    var losMod=ext&&isFinite(state)?!!(state&0x2):null;
    if(losPin!=null||losMod!=null){
      var v=(losMod!=null&&losPin!=null&&losMod!==losPin)
        ?("pin="+losPin+" mod="+losMod+" !"):t((losMod!=null?losMod:losPin)?"c_yes":"c_no");
      rows.push([t("p_rxlos"),v]);
    }
  }else if(p.adv){
    var bits=parseInt(p.adv,2),names=["10M "+t("c_half"),"10M "+t("c_full"),"100M "+t("c_half"),"100M "+t("c_full"),"1G","2.5G"];
    var on=names.filter(function(_,b){return bits&(1<<b)});
    rows.push([t("p_adv"),on.join(", ")||"-"]);
  }
  return rows;
}
function detailTable(p){
  var tb=h("table",{class:"t"});
  portRows(p).forEach(function(r){
    tb.appendChild(h("tr",null,[h("td",{class:"mut",text:r[0]}),h("td",{text:r[1]})]));
  });
  return tb;
}
