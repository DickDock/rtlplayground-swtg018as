// Energy-efficient ethernet tab.
// Part of app.js: files in html/app/ are concatenated in filename order.
function spDots(bits){
  var b=parseInt(bits,2)||0;
  var w=h("span",{class:"spdots"});
  ["100M","1G","2.5G"].forEach(function(s,i){
    w.appendChild(h("span",{class:(b&(4>>i))?"on":"",text:s}));
  });
  return w;
}
function eeeLoad(){
  return getJSON("/eee.json").then(function(s){
    var tb=$("etable").tBodies[0];tb.innerHTML="";
    byPort(s).forEach(function(p){
      var tr=tb.insertRow();
      tr.insertCell().textContent=p.portNum+(p.isSFP?" (SFP)":"");
      if(p.isSFP){
        var na1=tr.insertCell(),na2=tr.insertCell();
        na1.appendChild(spDots("0"));
        na2.appendChild(spDots("0"));
        tr.insertCell().textContent=t("e_na");
        var na3=tr.insertCell();
        return;
      }
      tr.insertCell().appendChild(spDots(p.eee));
      tr.insertCell().appendChild(spDots(p.eee_lp));
      tr.insertCell().innerHTML=p.active?badge(t("e_active"),"ok"):badge(t("e_idle"));
      var on=parseInt(p.eee,2)!==0;
      var sw=h("label",{class:"switch"},[
        h("input",{type:"checkbox",onchange:function(){
          postCmd("eee "+(this.checked?"on":"off")+" "+p.portNum)
            .then(function(){setTimeout(eeeLoad,300)}).catch(function(){});
        }}),h("i")]);
      sw.firstChild.checked=on;
      tr.insertCell().appendChild(sw);
    });
  });
}
var eeePoller=new Poller(function(){return eeeLoad()},4000);
tabHooks.eee={enter:function(){eeePoller.start()},leave:function(){eeePoller.stop()}};

