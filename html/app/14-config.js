// Save-to-flash: config merge rules and the write dialog.
// Part of app.js: files in html/app/ are concatenated in filename order.
var CONF_OVERWRITE=[
  /^ip\b/,/^gw\b/,/^netmask\b/,/^hostname\b/,
  /^syslog\s+ip\b/,/^syslog\s+port\b/,/^passwd\b/,/^session\b/,
  /^vlan\s+\d{1,4}\s+mgmt$/,/^vlan\s+\d{1,4}(?!\s+mgmt\b)/,
  /^pvid\s+\d{1,2}\b/,
  /^port\s+\d{1,2}(?!\s+name\b)/,/^port\s+\d{1,2}\s+name\b/,
  /^mirror\b/,
  /^lag\s+\d\b/,/^laghash\s+\d\b/,/^isolate\s+\d{1,2}\b/,
  /^stp\s+(prio|hello|maxage|fwd|txhold|version)\b/,
  /^stp\s+(port\s+\d{1,2}|lag\s+[1-4])\s+(edge|cost|prio|guard|filter|p2p)\b/,
  /^igmp\b/,/^mtu\s+\d{1,2}\b/,/^storm\s+\d{1,2}\s+(bcast|mcast|ucast|umcast)\b/,
  /^qos\s+trust\b/,/^qos\s+dscp\s+\S+/,/^qos\s+(1p|queue)\s+\d\b/,/^qos\s+port\s+\d{1,2}\b/,
  /^qos\s+sched\s+\d{1,2}\s+\d\b/,
  /^fc\s+\d{1,2}\s+set\b/,/^fc\s+thr\s+(glb|\d)\b/,/^fc\s+guar\s+\d\b/,
];
var CONF_TOGGLE=[/^(syslog)\s+(on|off)$/,/^(stp)\s+(on|off)$/,/^(stp\s+(port\s+\d{1,2}|lag\s+[1-4]))\s+(on|off)$/];
function mergeConf(base,texts){
  var conf=base.slice();
  function drop(rx){conf=conf.filter(function(c){return!rx.test(c)})}
  texts.forEach(function(txt){
    txt.split(/\r?\n/).forEach(function(line){
      line=line.trim().replace(/\s+/g," ");
      if(!line)return;
      var m;
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
      for(var i=0;i<CONF_TOGGLE.length;i++){
        if((m=line.match(CONF_TOGGLE[i]))){drop(new RegExp("^"+m[1]+" (on|off)$"));break;}
      }
      for(var j=0;j<CONF_OVERWRITE.length;j++){
        var rx=CONF_OVERWRITE[j];
        if(rx.test(line)){
          var key=line.match(rx)[0];
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
function writeConfig(txt,title,fromLog){
  var info=h("p",{class:"small mut"}),warn=h("p",{class:"small"});
  var ed=h("textarea",{class:"cfg",spellcheck:"false",placeholder:t("cw_empty"),style:"min-height:45vh"});
  ed.value=txt.replace(/\r\n/g,"\n");
  var ok=h("button",{class:"ctl pri",text:t("sy_write"),onclick:function(){closeModal();doWriteConfig(cfgText(ed.value),fromLog)}});
  function refresh(){
    var v=cfgText(ed.value),bytes=new Blob([v]).size,long=cfgLongLine(v);
    var unknown=v.split("\n").filter(function(l){return l.trim()&&!isConfCmd(l.trim().replace(/\s+/g," "))});
    info.textContent=t("cw_info",{n:bytes});
    ok.disabled=bytes>2048||!!long;
    warn.style.color=ok.disabled?"var(--bad)":"var(--warn)";
    warn.textContent=bytes>2048?t("cw_toolarge"):long?t("cw_longline",long):(unknown.length?t("cw_unknown")+unknown.join(" | "):"");
  }
  ed.addEventListener("input",refresh);refresh();
  modal(title,h("div",null,[info,warn,ed]),[h("button",{class:"ctl",text:t("c_cancel"),onclick:closeModal}),ok]);
}
function cfgText(txt){
  txt=txt.replace(/\r\n/g,"\n");
  return txt&&txt.slice(-1)!=="\n"?txt+"\n":txt;
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
$("saveBtn").addEventListener("click",function(){
  toast(t("cw_collect"));
  Promise.all([
    getText("/config").catch(function(){return""}),
    getText("/cmd_log").catch(function(){return""}),
  ]).then(function(r){
    var cur=r[0].replace(/\0[\s\S]*$/,"").split(/\r?\n/).map(function(l){return l.trim().replace(/\s+/g," ")}).filter(Boolean);
    var merged=mergeConf(cur,[r[1].replace(/\0[\s\S]*$/,"")]);
    writeConfig(merged.join("\n"),t("cw_save_title"),true);
  });
});

