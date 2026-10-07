"use strict";
// Configuration persistence: CLI grammar rules, dirty tracking, command
// posting and the save-to-flash merge.
// Part of app.js: files in html/app/ are concatenated in filename order.
// CONF_RULES is the single source of CLI syntax knowledge:
//   re - the command form (isConfCmd, dirty marking, unknown-line warning)
//   ow - overwrite key regex: matching lines replace older lines with the
//        same key during mergeConf (absent = handled by a special case)
//   tg - capture group holding the prefix for on/off toggle replacement
// No DOM side effects at top level; saveRun is wired in 99-boot.js.
var CONF_RULES=[
  {re:/^ip\s+(\d{1,3}\.){3}\d{1,3}$/,ow:/^ip\b/},
  {re:/^ip\s+dhcp$/,ow:/^ip\b/},
  {re:/^gw\s+(\d{1,3}\.){3}\d{1,3}$/,ow:/^gw\b/},
  {re:/^netmask\s+(\d{1,3}\.){3}\d{1,3}$/,ow:/^netmask\b/},
  {re:/^(syslog)\s+(on|off)$/,tg:1},
  {re:/^syslog\s+ip\s+(\d{1,3}\.){3}\d{1,3}$/,ow:/^syslog\s+ip\b/},
  {re:/^syslog\s+port\s+\d{1,5}$/,ow:/^syslog\s+port\b/},
  {re:/^session\s+\d{1,5}$/,ow:/^session\b/},
  {re:/^passwd\s+\S+$/,ow:/^passwd\b/},
  {re:/^hostname\s+\S{1,23}$/,ow:/^hostname\b/},
  {re:/^vlan\s+\d{1,4}\s+d$/},
  {re:/^vlan\s+\d{1,4}\s+mgmt$/,ow:/^vlan\s+\d{1,4}\s+mgmt$/},
  {re:/^vlan\s+\d{1,4}(\s+[a-zA-Z]\w*)?(\s+\d{1,2}t?)+$/,ow:/^vlan\s+\d{1,4}(?!\s+mgmt\b)/},
  {re:/^pvid\s+\d{1,2}\s+\d{1,4}$/,ow:/^pvid\s+\d{1,2}\b/},
  {re:/^ingress(\s+\d{1,2}[tua])+$/},
  {re:/^ingress\s+[tua]$/},
  {re:/^port\s+\d{1,2}\s+(10m|100m|1g|2g5|5g|10g|auto|on|off)(\s+(half|full))?$/,ow:/^port\s+\d{1,2}(?!\s+name\b)/},
  {re:/^port\s+\d{1,2}\s+name\s+\S+$/,ow:/^port\s+\d{1,2}\s+name\b/},
  {re:/^eee\s+(on|off)(\s+\d{1,2})?(\s+(100m|1g|2g5))?$/},
  {re:/^mirror(\s+\d{1,2})(\s+\d{1,2}[tr]?)+$/,ow:/^mirror\b/},
  {re:/^mirror\s+off$/},
  {re:/^lag\s+[1-4](\s+\d{1,2})+$/,ow:/^lag\s+\d\b/},
  {re:/^lag\s+[1-4]\s+d$/},
  {re:/^lag\s+[1-4]\s+lacp(\s+\d{1,2})+$/,ow:/^lag\s+\d\b/},
  {re:/^lag\s+[1-4]\s+lacp\s+off$/},
  {re:/^laghash\s+[1-4](\s+\w+)+$/,ow:/^laghash\s+\d\b/},
  {re:/^isolate\s+\d{1,2}(\s+(off|\d{1,2}))+$/,ow:/^isolate\s+\d{1,2}\b/},
  {re:/^(stp)\s+(on|off)$/,tg:1},
  {re:/^stp\s+(prio|hello|maxage|fwd|txhold)\s+\d{1,2}$/,ow:/^stp\s+(prio|hello|maxage|fwd|txhold|version)\b/},
  {re:/^stp\s+version\s+(rstp|stp)$/,ow:/^stp\s+(prio|hello|maxage|fwd|txhold|version)\b/},
  {re:/^(stp\s+(port\s+\d{1,2}|lag\s+[1-4]))\s+(on|off)$/,tg:1},
  {re:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+edge\s+(on|off|auto)$/,ow:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+(edge|cost|prio|guard|filter|p2p)\b/},
  {re:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+cost\s+\d{1,9}$/,ow:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+(edge|cost|prio|guard|filter|p2p)\b/},
  {re:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+prio\s+\d{1,3}$/,ow:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+(edge|cost|prio|guard|filter|p2p)\b/},
  {re:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+guard\s+(none|bpdu|root)$/,ow:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+(edge|cost|prio|guard|filter|p2p)\b/},
  {re:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+filter\s+(on|off)$/,ow:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+(edge|cost|prio|guard|filter|p2p)\b/},
  {re:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+p2p\s+(auto|on|off)$/,ow:/^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+(edge|cost|prio|guard|filter|p2p)\b/},
  {re:/^igmp\s+(on|off)$/,ow:/^igmp\b/},
  {re:/^mtu\s+\d{1,2}\s+\d+$/,ow:/^mtu\s+\d{1,2}\b/},
  {re:/^bw\s+(in|out)\s+\d{1,2}\s+\S+$/},
  {re:/^storm\s+\d{1,2}\s+(bcast|mcast|ucast|umcast)\s+(off|\d{1,8}\s+(pps|kbps))$/,ow:/^storm\s+\d{1,2}\s+(bcast|mcast|ucast|umcast)\b/},
  {re:/^qos\s+trust\s+(dscp|1p|port)$/,ow:/^qos\s+trust\b/},
  {re:/^qos\s+dscp\s+\S+\s+\d$/,ow:/^qos\s+dscp\s+\S+/},
  {re:/^qos\s+(1p|queue)\s+\d\s+\d$/,ow:/^qos\s+(1p|queue)\s+\d\b/},
  {re:/^qos\s+port\s+\d{1,2}\s+\d$/,ow:/^qos\s+port\s+\d{1,2}\b/},
  {re:/^qos\s+sched\s+\d{1,2}\s+\d\s+(strict|\d{1,3})$/,ow:/^qos\s+sched\s+\d{1,2}\s+\d\b/},
  {re:/^fc\s+\d{1,2}\s+(auto|on|off)$/},
  {re:/^fc\s+\d{1,2}\s+set\s+\d$/,ow:/^fc\s+\d{1,2}\s+set\b/},
  {re:/^fc\s+thr\s+(glb|\d)\s+\S+\s+\S+$/,ow:/^fc\s+thr\s+(glb|\d)\b/},
  {re:/^fc\s+guar\s+\d\s+\S+$/,ow:/^fc\s+guar\s+\d\b/},
  {re:/^pfc\s+\d{1,2}\s+(on\s+[0-7](,[0-7])*|off|map)$/},
];
function isConfCmd(line){
  for(var i=0;i<CONF_RULES.length;i++)if(CONF_RULES[i].re.test(line))return true;
  return false;
}
function setDirty(d){
  S.dirty=d;
  var el=$("dirty");
  if(el)el.classList.toggle("show",d);
}
function postCmd(cmd,quiet){
  return api("/cmd",{method:"POST",body:cmd}).then(function(r){
    if(!r.ok)throw new Error(((r.body||"").split("\n")[0])||t("t_rejected",{c:cmd}));
    if(isConfCmd(cmd.trim()))setDirty(true);
    if(!quiet)toast(t("t_applied",{c:cmd}),"ok");
    return r;
  },function(e){toast(e.message||t("t_failed",{c:cmd}),"err");throw e;});
}
function postCmds(list){
  var p=Promise.resolve();
  list.forEach(function(c){p=p.then(function(){return postCmd(c,true)})});
  return p.then(function(){toast(t("t_cmds",{n:list.length}),"ok")});
}

function mergeConf(base,texts){
  var conf=base.slice();
  function drop(rx){conf=conf.filter(function(c){return!rx.test(c)})}
  texts.forEach(function(txt){
    txt.split(/\r?\n/).forEach(function(line){
      line=line.trim().replace(/\s+/g," ");
      if(!line)return;
      var m,i;
      if((m=line.match(/^vlan (\d{1,4}) d$/))){drop(new RegExp("^vlan "+m[1]+"( |$)"));return;}
      if((m=line.match(/^lag (\d) d$/))){drop(new RegExp("^lag(hash)? "+m[1]+"( |$)"));return;}
      if((m=line.match(/^eee (on|off)(?: (\d{1,2}))?(?: (?:100m|1g|2g5))?$/))){
        if(m[2])drop(new RegExp("^eee (on|off) "+m[2]+"\\b"));
        else drop(/^eee /);
        conf.push(line);return;
      }
      if((m=line.match(/^lag (\d) lacp off$/))){drop(new RegExp("^lag "+m[1]+" lacp( |$)"));return;}
      if(line==="mirror off"){drop(/^mirror /);return;}
      if(!isConfCmd(line))return;
      if((m=line.match(/^ingress (.+)$/))){
        if(/^[tua]$/.test(m[1])){drop(/^ingress /);conf.push(line);return;}
        var ports={},order=[],last=-1;
        conf.forEach(function(c,i){if(/^ingress [tua]$/.test(c))last=i;});
        conf.forEach(function(c,i){
          var cm=c.match(/^ingress (.+)$/);
          if(!cm||/^[tua]$/.test(cm[1])||i<last)return;
          cm[1].split(" ").forEach(function(tk){var n=tk.slice(0,-1);if(!(n in ports))order.push(n);ports[n]=tk;});
        });
        m[1].split(" ").forEach(function(tk){var n=tk.slice(0,-1);if(!(n in ports))order.push(n);ports[n]=tk;});
        conf=conf.filter(function(c){var cm=c.match(/^ingress (.+)$/);return!cm||/^[tua]$/.test(cm[1])});
        order.sort(function(a,b){return a-b});
        conf.push("ingress "+order.map(function(n){return ports[n]}).join(" "));
        return;
      }
      if((m=line.match(/^(p?fc \d{1,2}) (auto|on|off|on \S+)$/))){
        drop(new RegExp("^"+m[1]+" (auto|on|off)( |$)"));
        conf.push(line);return;
      }
      if((m=line.match(/^bw (in|out) (\d{1,2}) (\S+)$/))){
        var pre="^bw "+m[1]+" "+m[2]+" ";
        if(m[1]==="out"||m[3]==="off")drop(new RegExp(pre));
        else if(m[3]==="drop"||m[3]==="fc")drop(new RegExp(pre+"(drop|fc)$"));
        else drop(new RegExp(pre+"(off|[0-9a-f]+)$"));
        conf.push(line);return;
      }
      for(i=0;i<CONF_RULES.length;i++){
        if(CONF_RULES[i].tg!=null&&(m=line.match(CONF_RULES[i].re))){
          drop(new RegExp("^"+m[CONF_RULES[i].tg]+" (on|off)$"));break;
        }
      }
      for(i=0;i<CONF_RULES.length;i++){
        var ow=CONF_RULES[i].ow;
        if(ow&&ow.test(line)){
          var key=line.match(ow)[0];
          conf=conf.filter(function(item){
            return!(item===key||(item.indexOf(key+" ")===0
              &&!/\smgmt$/.test(item)&&item.indexOf(key+" name ")!==0));
          });
          break;
        }
      }
      if(/^vlan \d{1,4} mgmt$/.test(line))drop(/^vlan \d{1,4} mgmt$/);
      conf.push(line);
    });
  });
  return conf;
}
function cfgText(txt){
  txt=txt.replace(/\r\n/g,"\n");
  return txt&&txt.slice(-1)!=="\n"?txt+"\n":txt;
}
function cfgLongLine(txt){
  var lines=txt.split("\n");
  for(var i=0;i<lines.length;i++)
    if(new Blob([lines[i]]).size>126)return{i:i+1,m:new Blob([lines[i]]).size};
  return null;
}
function writeConfig(txt,title,fromLog){
  var info=h("p",{class:"small mut"}),warn=h("p",{class:"small"});
  var ed=h("textarea",{class:"cfg",spellcheck:"false",placeholder:t("cw_empty"),style:"min-height:45vh"});
  /* Rendered copy of the config with unknown lines underlined (pre.cfg u). */
  var prev=h("pre",{class:"cfg",style:"display:none;margin-top:8px;max-height:18vh"});
  ed.value=txt.replace(/\r\n/g,"\n");
  var ok=h("button",{class:"ctl pri",text:t("sy_write"),onclick:function(){closeModal();doWriteConfig(cfgText(ed.value),fromLog)}});
  function refresh(){
    var v=cfgText(ed.value),bytes=new Blob([v]).size,long=cfgLongLine(v);
    var unknown=v.split("\n").filter(function(l){return l.trim()&&!isConfCmd(l.trim().replace(/\s+/g," "))});
    info.textContent=t("cw_info",{n:bytes});
    ok.disabled=bytes>2048||!!long;
    warn.style.color=ok.disabled?"var(--bad)":"var(--warn)";
    warn.textContent=bytes>2048?t("cw_toolarge"):long?t("cw_longline",long):(unknown.length?t("cw_unknown")+unknown.join(" | "):"");
    prev.style.display=unknown.length?"":"none";
    if(unknown.length)prev.innerHTML=v.split("\n").map(function(l){
      return l.trim()&&!isConfCmd(l.trim().replace(/\s+/g," "))?"<u>"+esc(l)+"</u>":esc(l);
    }).join("\n");
  }
  ed.addEventListener("input",refresh);refresh();
  modal(title,h("div",null,[info,warn,ed,prev]),[h("button",{class:"ctl",text:t("c_cancel"),onclick:closeModal}),ok]);
}
function doWriteConfig(txt,fromLog){
  var form=new FormData();
  form.append("configuration",new Blob([txt],{type:"application/octet-stream"}),"config.txt");
  toast(t("cw_writing"));
  api("/config",{method:"POST",body:form}).then(function(r){
    if(!r.ok)throw new Error(t("cw_failed",{n:r.status}));
    return getText("/config");
  }).then(function(back){
    back=back.replace(/\0[\s\S]*$/,"").replace(/\r\n/g,"\n").trim();
    if(back!==txt.trim())throw new Error(t("cw_verify_fail"));
    if(!fromLog)return false;
    return api("/cmd_log_clear").then(function(){return true},function(){return true});
  }).then(function(cleared){
    if(cleared)setDirty(false);
    $("cfgedit").value=txt;cfgBytes();cfgParseKnown(txt);
    toast(t("cw_saved"),"ok");
  }).catch(function(e){toast(e.message||String(e),"err")});
}
function saveRun(){
  toast(t("cw_collect"));
  Promise.all([
    getText("/config").catch(function(){return""}),
    getText("/cmd_log").catch(function(){return""}),
  ]).then(function(r){
    var cur=r[0].replace(/\0[\s\S]*$/,"").split(/\r?\n/).map(function(l){return l.trim().replace(/\s+/g," ")}).filter(Boolean);
    var merged=mergeConf(cur,[r[1].replace(/\0[\s\S]*$/,"")]);
    writeConfig(merged.join("\n"),t("cw_save_title"),true);
  });
}
