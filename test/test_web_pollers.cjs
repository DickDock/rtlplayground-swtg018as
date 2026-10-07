"use strict";

// 只用 Node 内建模块，抽取实际前端函数；计时器、请求和 DOM 均不访问设备。
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../html/app.js"),"utf8");

function section(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,"找不到生产代码片段: "+start);
  return source.slice(a,b);
}
function hook(name){
  const start=source.indexOf("tabHooks."+name+"=");
  assert.ok(start>=0,"找不到页面 hook: "+name);
  return source.slice(start,source.indexOf(";\n",start)+1);
}
function deferred(){
  let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b});
  return {promise,resolve,reject};
}
async function flush(){for(let i=0;i<24;i++)await Promise.resolve()}

class Clock{
  constructor(){this.now=1000000;this.next=1;this.timers=new Map()}
  setTimeout(fn,ms){
    const id=this.next++;
    this.timers.set(id,{fn,at:this.now+ms});
    return id;
  }
  clearTimeout(id){this.timers.delete(id)}
  advance(ms){
    const end=this.now+ms;
    for(;;){
      const due=[...this.timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0]);
      if(!due.length)break;
      const [id,t]=due[0];
      this.now=t.at;this.timers.delete(id);t.fn();
    }
    this.now=end;
  }
}
class Element{
  constructor(tag){
    this.tagName=tag.toUpperCase();this.children=[];this.events={};this.style={};this.checked=false;
    this._text="";this.attrs={};this.parentNode=null;
    const classes=new Set();
    this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v),
      toggle:(v,on)=>{if(on==null)on=!classes.has(v);if(on)classes.add(v);else classes.delete(v);return on}};
  }
  appendChild(el){this.children.push(el);el.parentNode=this;return el}
  set textContent(v){this._text=String(v);this.children=[]}
  get textContent(){return this._text+this.children.map(e=>e.textContent).join("")}
  set innerHTML(v){this._text=String(v);this.children=[]}
  get innerHTML(){return this._text}
  get firstChild(){return this.children[0]}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==="checked")this.checked=true;else this[k]=String(v)}
  addEventListener(ev,fn){(this.events[ev]||(this.events[ev]=[])).push(fn)}
  emit(ev,extra={}){for(const fn of this.events[ev]||[])fn.call(this,{target:this,...extra})}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(e=>e!==this)}
}
function descendants(el,tag){
  return el.children.flatMap(c=>[...(c.tagName===tag.toUpperCase()?[c]:[]),...descendants(c,tag)]);
}
function harness(extra={},parts=[]){
  const clock=new Clock(),ids=new Map(),events={};
  const document={hidden:false,activeElement:null,
    getElementById:id=>{if(!ids.has(id))ids.set(id,new Element("div"));return ids.get(id)},
    createElement:tag=>new Element(tag),createTextNode:s=>{const e=new Element("text");e.textContent=s;return e}};
  const context=vm.createContext({Promise,console,Number,BigInt,DataView,Uint8Array,AbortController,
    Date:{now:()=>clock.now},setTimeout:clock.setTimeout.bind(clock),clearTimeout:clock.clearTimeout.bind(clock),
    document,window:{AbortController},location:{hash:"#dash"},history:{replaceState(){}},
    addEventListener:(ev,fn)=>{events[ev]=fn},t:k=>k,S:{detail:null,n:1,ports:[]},
    getJSON:()=>Promise.resolve([]),decodeCounters:()=>[["Counter",1n]],
    pollInfo:()=>Promise.resolve(),buildPorts(){},portsMacs(){},portsStatus(){},dashStatus(){},statsStatus(){},
    buildLag(){},lagLoad:()=>Promise.resolve(),ctrPoll:null,l2Gen:0,statusPoller:{start(){},stop(){}},
    ...extra});
  const code=[
    section("var $=","\nfunction esc("),
    section("function toast(","\nfunction confirmModal("),
    section("var TABS=","\nTABS.forEach(function(tb){\n  $(\"navlist\")"),
    section("var IDLE_STOP_MS=","\nfunction byPort("),
    ...parts
  ].join("\n");
  vm.runInContext(code,context,{filename:"app.js (实际片段)"});
  return {ctx:context,clock,ids,document,input:ev=>events[ev](),el:id=>document.getElementById(id)};
}
const countersCode=()=>section("var ctrPoll=","\nfunction statsStatus(");
const lagCode=()=>section(source.includes("var lagGen=")?"var lagGen=":"var lagPoller=","\nfunction spDots(");
const needPortsCode=()=>section("function needPorts(","\nfunction fmtPps(");
const apiCode=()=>section("var _q=","\nvar CONF_CMDS=");
const sfpCode=()=>section("function pU16(","\nfunction detailTable(")+section("function dashSfp(","\nfunction dashStatus(");

// 每个用例都跑在独立 VM 中，旧微任务和过期回调可精确复现。
test("Poller: 正常周期及重复 start/stop 只有一条链",async()=>{
  const {ctx,clock}=harness();let calls=0;
  const p=new ctx.Poller(()=>{calls++},2500);
  p.start();p.start();await flush();
  assert.equal(calls,1);assert.equal(clock.timers.size,1);
  clock.advance(2499);await flush();assert.equal(calls,1);
  clock.advance(1);await flush();assert.equal(calls,2);assert.equal(clock.timers.size,1);
  p.start();assert.equal(clock.timers.size,1);p.stop();p.stop();
  clock.advance(10000);await flush();assert.equal(calls,2);assert.equal(clock.timers.size,0);
});
test("Poller: stop 使尚未执行的旧微任务失效",async()=>{
  const {ctx,clock}=harness();let calls=0;
  const p=new ctx.Poller(()=>{calls++},2500);
  p.start();p.stop();await flush();
  assert.equal(calls,0);assert.equal(clock.timers.size,0);
});
test("Poller: 同步 leave-return 只执行最新世代",async()=>{
  const {ctx,clock}=harness();let calls=0;
  const p=new ctx.Poller(()=>{calls++},2500);
  p.start();p.stop();p.start();p.start();await flush();
  assert.equal(calls,1);assert.equal(clock.timers.size,1);
});
test("Poller: 重启等待旧请求结束，不并发也不排多份请求",async()=>{
  const {ctx,clock}=harness(),requests=[];let active=0,maxActive=0;
  const p=new ctx.Poller(()=>{
    active++;maxActive=Math.max(maxActive,active);
    const d=deferred();requests.push(d);return d.promise.finally(()=>{active--});
  },2500);
  p.start();await flush();
  for(let i=0;i<5;i++){p.stop();p.start()}
  await flush();assert.equal(requests.length,1);assert.equal(clock.timers.size,0);
  requests[0].resolve();await flush();
  assert.equal(requests.length,2);assert.equal(maxActive,1);assert.equal(clock.timers.size,0);
  requests[1].resolve();await flush();assert.equal(clock.timers.size,1);p.stop();
});
test("Poller: 已发出的请求允许完成，停止后不重新挂 timer",async()=>{
  const {ctx,clock}=harness(),d=deferred();let completed=0;
  const p=new ctx.Poller(()=>d.promise.then(()=>{completed++}),2500);
  p.start();await flush();p.stop();d.resolve();await flush();
  assert.equal(completed,1);assert.equal(clock.timers.size,0);
});
test("Poller: 在请求 pending 时重复 tick 不产生并发",async()=>{
  const {ctx}=harness(),d=deferred();let calls=0;
  const p=new ctx.Poller(()=>{calls++;return d.promise},2500);
  p.start();await flush();p.tick();p.tick();await flush();assert.equal(calls,1);
  p.stop();d.resolve();await flush();
});
test("Poller: 已清除但到达的旧 timer 不能复活或干扰新 timer",async()=>{
  const {ctx,clock}=harness();let calls=0;
  const p=new ctx.Poller(()=>{calls++},2500);
  p.start();await flush();const stale=[...clock.timers.values()][0].fn;
  p.stop();p.start();await flush();const fresh=[...clock.timers.keys()][0];
  stale();await flush();assert.equal(calls,2);assert.deepEqual([...clock.timers.keys()],[fresh]);
  p.stop();stale();await flush();assert.equal(clock.timers.size,0);
});
test("Poller: 同步 throw 后仍按周期恢复",async()=>{
  const {ctx,clock}=harness();let calls=0;
  const p=new ctx.Poller(()=>{calls++;if(calls===1)throw new Error("预期同步失败")},2500);
  p.start();await flush();assert.equal(clock.timers.size,1);
  clock.advance(2500);await flush();assert.equal(calls,2);assert.equal(clock.timers.size,1);p.stop();
});
test("Poller: Promise reject 后仍按周期恢复",async()=>{
  const {ctx,clock}=harness(),d=deferred();let calls=0;
  const p=new ctx.Poller(()=>{calls++;return calls===1?d.promise:Promise.resolve()},2500);
  p.start();await flush();d.reject(new Error("预期异步失败"));await flush();
  assert.equal(clock.timers.size,1);clock.advance(2500);await flush();assert.equal(calls,2);p.stop();
});
test("Poller: 旧请求 reject 后只接管最新重启",async()=>{
  const {ctx,clock}=harness(),d=deferred();let calls=0;
  const p=new ctx.Poller(()=>{calls++;return calls===1?d.promise:Promise.resolve()},2500);
  p.start();await flush();p.stop();p.start();await flush();assert.equal(calls,1);
  d.reject(new Error("预期旧请求失败"));await flush();
  assert.equal(calls,2);assert.equal(clock.timers.size,1);p.stop();
});
test("Poller: hidden 不发送请求，恢复可见后继续",async()=>{
  const {ctx,clock,document}=harness();let calls=0;
  const p=new ctx.Poller(()=>{calls++},2500);
  document.hidden=true;p.start();await flush();assert.equal(calls,0);assert.equal(clock.timers.size,1);
  clock.advance(2500);await flush();assert.equal(calls,0);
  document.hidden=false;clock.advance(2500);await flush();assert.equal(calls,1);p.stop();
});
test("Poller: 微任务发送前再检查 hidden",async()=>{
  const {ctx,clock,document}=harness();let calls=0;
  const p=new ctx.Poller(()=>{calls++},2500);
  p.start();document.hidden=true;await flush();assert.equal(calls,0);assert.equal(clock.timers.size,1);p.stop();
});
test("Poller: 10 分钟 idle 暂停，用户输入后继续",async()=>{
  const {ctx,clock,input}=harness();let calls=0;
  const p=new ctx.Poller(()=>{calls++},2500);
  clock.advance(ctx.IDLE_STOP_MS+1);p.start();await flush();assert.equal(calls,0);
  input("mousemove");clock.advance(2500);await flush();assert.equal(calls,1);p.stop();
});
test("Poller: idle 边界恰好 10 分钟仍可执行",async()=>{
  const {ctx,clock}=harness();let calls=0;
  const p=new ctx.Poller(()=>{calls++},2500);
  clock.advance(ctx.IDLE_STOP_MS);p.start();await flush();assert.equal(calls,1);
  clock.advance(2500);await flush();assert.equal(calls,1);p.stop();
});
test("页面切换: dashboard → ports → stats 共享轮询不叠加",async()=>{
  const requests=[];
  const {ctx,clock}=harness({needPorts:fn=>fn()},[hook("dash"),hook("ports"),hook("stats")]);
  ctx.statusPoller=new ctx.Poller(()=>{const d=deferred();requests.push(d);return d.promise},2500);
  ctx.showTab("dash");await flush();ctx.showTab("ports");ctx.showTab("stats");await flush();
  assert.equal(requests.length,1);requests[0].resolve();await flush();assert.equal(requests.length,2);
  requests[1].resolve();await flush();assert.equal(clock.timers.size,1);
  ctx.showTab("system");clock.advance(10000);await flush();assert.equal(requests.length,2);assert.equal(clock.timers.size,0);
});
test("LAG: needPorts pending 时离页，旧 callback 不得 start",async()=>{
  const pending=[];let builds=0,loads=0;
  const {ctx,clock}=harness({pollStatus:()=>{const d=deferred();pending.push(d);return d.promise},
    buildLag:()=>{builds++},lagLoad:()=>{loads++;return Promise.resolve()}},[needPortsCode(),lagCode()]);
  ctx.S.n=0;ctx.showTab("lag");ctx.showTab("system");pending[0].resolve();await flush();
  assert.equal(builds,0);assert.equal(loads,0);assert.equal(clock.timers.size,0);
});
test("LAG: pending leave-return 后旧 callback 不能冒充新进入",async()=>{
  const pending=[];let builds=0,starts=0,loads=0;
  const {ctx,clock}=harness({pollStatus:()=>{const d=deferred();pending.push(d);return d.promise},
    buildLag:()=>{builds++},lagLoad:()=>{loads++;return Promise.resolve()}},[needPortsCode(),lagCode()]);
  const start=ctx.lagPoller.start;
  ctx.lagPoller.start=function(){starts++;return start.call(this)};
  ctx.S.n=0;ctx.showTab("lag");ctx.showTab("system");ctx.showTab("lag");
  ctx.S.n=1;pending[1].resolve();await flush();pending[0].resolve();await flush();
  assert.equal(builds,1);assert.equal(starts,1);assert.equal(loads,1);assert.equal(clock.timers.size,1);
  ctx.showTab("system");
});
test("LAG: 快速离页重返等待已开始的 lagLoad",async()=>{
  const requests=[];
  const {ctx,clock}=harness({lagLoad:()=>{const d=deferred();requests.push(d);return d.promise}},[needPortsCode(),lagCode()]);
  ctx.showTab("lag");await flush();ctx.showTab("system");ctx.showTab("lag");await flush();
  assert.equal(requests.length,1);requests[0].resolve();await flush();assert.equal(requests.length,2);
  requests[1].resolve();await flush();assert.equal(clock.timers.size,1);ctx.showTab("system");
});

for(const route of ["×","遮罩","底部按钮","替换弹窗","离页","同页重新进入"]){
  test("计数器 modal: "+route+" 清理 owner，不再轮询",async()=>{
    let requests=0;
    const {ctx,clock,el}=harness({getJSON:()=>{requests++;return Promise.resolve([])}},[countersCode(),hook("stats")]);
    ctx.curTab="stats";ctx.showCounters(0);await flush();
    const poll=ctx.ctrPoll;let stops=0;const stop=poll.stop;
    poll.stop=function(){stops++;return stop.call(this)};
    const auto=descendants(el("mbody"),"input")[1];auto.checked=true;
    clock.advance(2500);await flush();assert.equal(requests,2);
    if(route==="×")el("mx").emit("click");
    if(route==="遮罩")el("mback").emit("click");
    if(route==="底部按钮")el("mfoot").children[1].emit("click");
    if(route==="替换弹窗")ctx.modal("replacement",ctx.h("div"));
    if(route==="离页")ctx.showTab("system");
    if(route==="同页重新进入")ctx.showTab("stats");
    assert.equal(poll.on,false);assert.equal(stops,1);assert.equal(ctx.ctrPoll,null);
    ctx.closeModal();assert.equal(stops,1);
    clock.advance(10000);await flush();assert.equal(requests,2);assert.equal(clock.timers.size,0);
  });
}
test("计数器 modal: 遮罩内部点击不能关闭 owner",async()=>{
  const {ctx,clock,el}=harness({},[countersCode()]);
  ctx.showCounters(0);await flush();el("mback").emit("click",{target:el("mbody")});
  assert.equal(ctx.ctrPoll.on,true);assert.equal(el("mback").classList.contains("show"),true);
  assert.equal(clock.timers.size,1);ctx.closeModal();
});
test("计数器 modal: 先清旧再注册新，不误停新实例",async()=>{
  const {ctx,clock,el}=harness({},[countersCode()]);
  ctx.showCounters(0);await flush();const old=ctx.ctrPoll;
  ctx.showCounters(1);const fresh=ctx.ctrPoll;await flush();
  assert.notEqual(old,fresh);assert.equal(old.on,false);assert.equal(fresh.on,true);assert.equal(clock.timers.size,1);
  const auto=descendants(el("mbody"),"input")[1];auto.checked=true;
  clock.advance(2500);await flush();assert.equal(fresh.on,true);assert.equal(clock.timers.size,1);
  ctx.closeModal();assert.equal(fresh.on,false);assert.equal(ctx.ctrPoll,null);
});
test("计数器 modal: 关闭后 pending GET 允许完成，但不复活 timer",async()=>{
  const d=deferred();let requests=0;
  const {ctx,clock}=harness({getJSON:()=>{requests++;return d.promise}},[countersCode()]);
  ctx.showCounters(0);ctx.closeModal();await flush();d.resolve([]);await flush();
  assert.equal(requests,1);assert.equal(clock.timers.size,0);
});
for(const route of ["关闭后成功","替换后成功","关闭后失败"]){
  test("计数器 modal: "+route+" 的旧 GET 不写过期 owner",async()=>{
    const pending=[];
    const {ctx,el}=harness({getJSON:()=>{const d=deferred();pending.push(d);return d.promise}},[countersCode()]);
    ctx.showCounters(0);await flush();
    const oldWrap=el("mbody").firstChild.children[1];
    if(route==="替换后成功")ctx.showCounters(1);else ctx.closeModal();
    if(route==="关闭后失败")pending[0].reject(new Error("预期旧弹窗失败"));else pending[0].resolve([]);
    await flush();assert.equal(oldWrap.textContent,"");assert.equal(oldWrap.children.length,0);
    if(route==="替换后成功"){
      pending[1].resolve([]);await flush();assert.equal(el("mbody").firstChild.children[1].children.length,1);ctx.closeModal();
    }
  });
}
test("计数器 modal: 旧 checkbox/刷新事件不能继续提交 GET",async()=>{
  let requests=0;
  const {ctx,el}=harness({getJSON:()=>{requests++;return Promise.resolve([])}},[countersCode()]);
  ctx.showCounters(0);await flush();const nz=descendants(el("mbody"),"input")[0],refresh=el("mfoot").firstChild;
  ctx.closeModal();nz.emit("change");refresh.emit("click");await flush();assert.equal(requests,1);
});
test("modal: 替换及重复关闭各只清理一次",()=>{
  const {ctx}=harness();let first=0,second=0;
  ctx.modal("first",ctx.h("div"),[],()=>{first++});
  ctx.modal("second",ctx.h("div"),[],()=>{second++});
  assert.equal(first,1);assert.equal(second,0);
  ctx.closeModal();ctx.closeModal();assert.equal(first,1);assert.equal(second,1);
});

function networkHarness(){
  const requests=[];
  const env=harness({fetch:(url,opts)=>{
    const headers=deferred(),body=deferred();requests.push({url,opts,headers,body});return headers.promise;
  }},[apiCode()]);
  function headers(i){requests[i].headers.resolve({ok:true,status:200,text:()=>requests[i].body.promise})}
  return {...env,requests,headers};
}
test("API: 共享队列等待完整 BODY，POST 顺序与参数不变",async()=>{
  const {ctx,requests,headers}=networkHarness();
  const a=ctx.api("/one"),b=ctx.api("/cmd",{method:"POST",body:"port 1 off"}),c=ctx.api("/three");
  await flush();assert.equal(requests.length,1);
  headers(0);await flush();assert.equal(requests.length,1);
  requests[0].body.resolve("first");await flush();assert.equal(requests.length,2);
  assert.equal(requests[1].url,"/cmd");assert.equal(requests[1].opts.method,"POST");assert.equal(requests[1].opts.body,"port 1 off");
  headers(1);requests[1].body.resolve("second");await flush();assert.equal(requests[2].url,"/three");
  headers(2);requests[2].body.resolve("third");const results=await Promise.all([a,b,c]);
  assert.deepEqual(results.map(r=>r.body),["first","second","third"]);
});
test("API: stop 不取消已发送 POST，并允许完整完成",async()=>{
  const {ctx,clock,requests,headers}=networkHarness();let completed=0;
  const p=new ctx.Poller(()=>ctx.api("/cmd",{method:"POST",body:"port 1 on"}).then(()=>{completed++}),2500);
  p.start();await flush();assert.equal(requests.length,1);p.stop();
  assert.equal(requests[0].opts.signal.aborted,false);
  headers(0);requests[0].body.resolve("ok");await flush();
  assert.equal(completed,1);assert.equal(clock.timers.size,0);assert.equal(requests[0].opts.signal.aborted,false);
});
test("API: 请求失败不破坏后续共享队列",async()=>{
  const {ctx,requests,headers}=networkHarness();
  const a=ctx.api("/fail").catch(e=>e.message),b=ctx.api("/next");await flush();
  requests[0].headers.reject(new Error("预期网络失败"));await flush();assert.equal(requests[1].url,"/next");
  headers(1);requests[1].body.resolve("ok");assert.equal(await a,"预期网络失败");assert.equal((await b).body,"ok");
});

function sfpPort(extra={}){
  return {portNum:9,isSFP:true,enabled:1,link:0,txG:"0x0",txB:"0x0",rxG:"0x0",rxB:"0x0",
    sfp_vendor:"vendor",sfp_options:0x40,sfp_temp:"0x0000",sfp_vcc:"0x0000",sfp_txbias:"0x0000",
    sfp_txpower:"0x0000",sfp_rxpower:"0x0000",sfp_state:"0x00",...extra};
}
test("SFP: 不完整/错误 DDM hex 不得位运算成零",()=>{
  const {ctx}=harness({},[sfpCode()]);
  for(const value of [undefined,null,"","0x","0xzz","0x1234z"]){
    assert.ok(Number.isNaN(ctx.pU16(value)),"pU16 应拒绝 "+value);
    assert.ok(Number.isNaN(ctx.pI16(value)),"pI16 应拒绝 "+value);
  }
  assert.equal(ctx.pU16("0xffff"),65535);assert.equal(ctx.pI16("0xffff"),-1);
  assert.equal(ctx.pI16("0x8000"),-32768);assert.equal(ctx.pI16("0x0000"),0);
});
test("SFP: detail 中 DDM 读取失败显示不可用而非零",()=>{
  const {ctx}=harness({},[sfpCode()]);
  const rows=ctx.portRows(sfpPort({sfp_temp:"0x",sfp_vcc:"0x",sfp_txbias:"0x",sfp_txpower:"0x",sfp_rxpower:"0x"}));
  for(const key of ["p_temp","p_vcc","p_txbias","p_txpower","p_rxpower"]){
    assert.equal(rows.find(r=>r[0]===key)[1],"-",key);
  }
});
test("SFP: dashboard 中 DDM 读取失败显示不可用",()=>{
  const {ctx,el}=harness({},[sfpCode()]);
  ctx.S.ports=[sfpPort({sfp_temp:"0x",sfp_vcc:"0x",sfp_txpower:"0x",sfp_rxpower:"0x"})];ctx.dashSfp();
  assert.deepEqual(el("dsfpgrid").children.map(e=>e.children[0].textContent),["-","-","-","-"]);
});
test("SFP: state 无效不能伪装 TX fault/disable 或模块 LOS 为否",()=>{
  const {ctx}=harness({},[sfpCode()]);
  const rows=ctx.portRows(sfpPort({sfp_state:"0x",sfp_los:1}));
  assert.equal(rows.find(r=>r[0]==="p_txfault")[1],"-");
  assert.equal(rows.find(r=>r[0]==="p_txdis")[1],"-");
  assert.equal(rows.find(r=>r[0]==="p_rxlos")[1],"c_yes");
});
test("SFP: 缺少可选 calibration 的旧字段仍支持真实零值",()=>{
  const {ctx}=harness({},[sfpCode()]);
  const rows=ctx.portRows(sfpPort());
  assert.equal(rows.find(r=>r[0]==="p_temp")[1],"0.0 °C");
  assert.equal(rows.find(r=>r[0]==="p_vcc")[1],"0.00 V");
  assert.equal(rows.find(r=>r[0]==="p_txpower")[1],"0.000 mW / -40.00 dBm");
});
test("SFP: enabled 仅代表 admin，metadata 未 ready 不冒充 module present",()=>{
  const {ctx,el}=harness({},[sfpCode()]);
  const p={portNum:9,isSFP:true,enabled:1,link:0,txG:"0x0",txB:"0x0",rxG:"0x0",rxB:"0x0",sfp_los:1};
  const rows=ctx.portRows(p);
  assert.equal(rows.find(r=>r[0]==="p_state")[1],"c_down");
  assert.equal(rows.some(r=>r[0]==="p_module"||r[0]==="p_temp"),false);
  ctx.S.ports=[sfpPort()];ctx.dashSfp();assert.equal(el("dsfpgrid").children.length,4);
  ctx.S.ports=[p];ctx.dashSfp();assert.equal(el("d_sfpcard").style.display,"none");
});
test("SFP: vendor 有而 options 缺失不读取 DDM",()=>{
  const {ctx,el}=harness({},[sfpCode()]);
  const p=sfpPort({sfp_options:undefined});
  assert.equal(ctx.portRows(p).some(r=>r[0]==="p_temp"),false);
  ctx.S.ports=[p];ctx.dashSfp();assert.equal(el("dsfpgrid").children.length,0);
});
test("SFP: 混合无效数据只将失败测项显示不可用",()=>{
  const {ctx}=harness({},[sfpCode()]);
  const rows=ctx.portRows(sfpPort({sfp_temp:"0x",sfp_txpower:"0x",sfp_vcc:"0x2710"}));
  assert.equal(rows.find(r=>r[0]==="p_temp")[1],"-");
  assert.equal(rows.find(r=>r[0]==="p_txpower")[1],"-");
  assert.equal(rows.find(r=>r[0]==="p_vcc")[1],"1.00 V");
});
test("SFP: 无效 calibration 不得伪装有效读数",()=>{
  const {ctx}=harness({},[sfpCode()]);
  assert.ok(Number.isNaN(ctx.calSO(256,"0x")));
  assert.ok(Number.isNaN(ctx.calRx(123,"0x"+"g".repeat(40))));
  assert.equal(ctx.calSO(256,"0x01000000"),256);
  assert.equal(ctx.calRx(123,"0x0000000000000000000000003f80000000000000"),123);
});
