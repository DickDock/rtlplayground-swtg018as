"use strict";

// 只用 Node 内建模块，整文件求值 html/app/ 分片；计时器、请求和 DOM 均不访问设备。
// 约定：00/01/02 等核心分片在顶层不得有 DOM 副作用（本文件靠这一点整文件求值），
// 页面分片顶层的 $("id").addEventListener 依赖假 DOM 自动建元素。
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");
const vm=require("node:vm");
const appDir=path.join(__dirname,"../html/app");
const ALL=fs.readdirSync(appDir).sort().filter(f=>f.endsWith(".js"));
const CORE=["00-i18n.js","01-core.js"];

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
  get options(){return this.children}
  setAttribute(k,v){
    this.attrs[k]=String(v);
    if(k==="checked")this.checked=true;
    else if(k==="class")String(v).split(/\s+/).forEach(c=>c&&this.classList.add(c));
    else this[k]=String(v);
  }
  getAttribute(k){return this.attrs[k]==null?null:this.attrs[k]}
  addEventListener(ev,fn){(this.events[ev]||(this.events[ev]=[])).push(fn)}
  emit(ev,extra={}){for(const fn of this.events[ev]||[])fn.call(this,{target:this,...extra})}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(e=>e!==this)}
  closest(){return null}
  querySelector(){return null}
  querySelectorAll(){return[]}
  scrollIntoView(){}
}
function descendants(el,tag){
  return el.children.flatMap(c=>[...(c.tagName===tag.toUpperCase()?[c]:[]),...descendants(c,tag)]);
}
// 默认只装核心分片；其余按用例需要显式加入 files。
function harness(extra={},files=CORE,hash="#dash"){
  const clock=new Clock(),ids=new Map(),events={};
  const document={hidden:false,activeElement:null,documentElement:{dataset:{}},
    getElementById:id=>{if(!ids.has(id))ids.set(id,new Element("div"));return ids.get(id)},
    createElement:tag=>new Element(tag),createTextNode:s=>{const e=new Element("text");e.textContent=s;return e},
    querySelectorAll:()=>[]};
  const context=vm.createContext({Promise,console,Number,BigInt,DataView,Uint8Array,Array,Object,JSON,Math,String,RegExp,
    parseInt,parseFloat,isNaN,isFinite,AbortController,
    Date:{now:()=>clock.now},setTimeout:clock.setTimeout.bind(clock),clearTimeout:clock.clearTimeout.bind(clock),
    document,window:{AbortController,matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){}},
    location:{hash},history:{replaceState(){}},
    addEventListener:(ev,fn)=>{events[ev]=fn},
    navigator:{language:"en"},localStorage:{getItem:()=>null,setItem(){}},
    Blob:class{constructor(parts){this.size=(parts||[]).reduce((n,p)=>n+(p.length||0),0)}},
    // 默认 fetch 桩:core 的 api()/getJSON() 走真实现；用例按需覆盖。
    fetch:()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve("[]")})});
  for(const f of files)
    vm.runInContext(fs.readFileSync(path.join(appDir,f),"utf8"),context,{filename:f});
  // 加载后再覆盖:分片内的 function 声明会遮住 context 全局,只有
  // 装载完成后赋值的桩才保证生效。
  Object.assign(context,extra);
  // 99-boot 里的 modal 关闭接线在单测中手动等效补上。
  document.getElementById("mx").addEventListener("click",context.closeModal);
  document.getElementById("mback").addEventListener("click",function(e){if(e.target===this)context.closeModal()});
  return {ctx:context,clock,ids,document,input:ev=>events[ev](),el:id=>document.getElementById(id)};
}

// ---------- Poller ----------
for(const [name,fn] of [
  ["正常周期及重复 start/stop 只有一条链",async()=>{
    const {ctx,clock}=harness();let calls=0;
    const p=new ctx.Poller(()=>{calls++},2500);
    p.start();p.start();await flush();
    assert.equal(calls,1);assert.equal(clock.timers.size,1);
    clock.advance(2499);await flush();assert.equal(calls,1);
    clock.advance(1);await flush();assert.equal(calls,2);assert.equal(clock.timers.size,1);
    p.start();assert.equal(clock.timers.size,1);p.stop();p.stop();
    clock.advance(10000);await flush();assert.equal(calls,2);assert.equal(clock.timers.size,0);
  }],
  ["stop 使尚未执行的旧微任务失效",async()=>{
    const {ctx,clock}=harness();let calls=0;
    const p=new ctx.Poller(()=>{calls++},2500);
    p.start();p.stop();await flush();
    assert.equal(calls,0);assert.equal(clock.timers.size,0);
  }],
  ["同步 start/stop 只执行最新世代",async()=>{
    const {ctx,clock}=harness();let calls=0;
    const p=new ctx.Poller(()=>{calls++},2500);
    p.start();p.stop();p.start();p.start();await flush();
    assert.equal(calls,1);assert.equal(clock.timers.size,1);
  }],
  ["重启等待旧请求结束，不并发也不排多份请求",async()=>{
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
  }],
  ["已发出的请求允许完成，停止后不重新挂 timer",async()=>{
    const {ctx,clock}=harness(),d=deferred();let completed=0;
    const p=new ctx.Poller(()=>d.promise.then(()=>{completed++}),2500);
    p.start();await flush();p.stop();d.resolve();await flush();
    assert.equal(completed,1);assert.equal(clock.timers.size,0);
  }],
  ["在请求 pending 时重复 tick 不产生并发",async()=>{
    const {ctx}=harness(),d=deferred();let calls=0;
    const p=new ctx.Poller(()=>{calls++;return d.promise},2500);
    p.start();await flush();p.tick();p.tick();await flush();assert.equal(calls,1);
    p.stop();d.resolve();await flush();
  }],
  ["已清除但到达的旧 timer 不能复活或干扰新 timer",async()=>{
    const {ctx,clock}=harness();let calls=0;
    const p=new ctx.Poller(()=>{calls++},2500);
    p.start();await flush();const stale=[...clock.timers.values()][0].fn;
    p.stop();p.start();await flush();const fresh=[...clock.timers.keys()][0];
    stale();await flush();assert.equal(calls,2);assert.deepEqual([...clock.timers.keys()],[fresh]);
    p.stop();stale();await flush();assert.equal(clock.timers.size,0);
  }],
  ["同步 throw 后仍按周期恢复",async()=>{
    const {ctx,clock}=harness();let calls=0;
    const p=new ctx.Poller(()=>{calls++;if(calls===1)throw new Error("预期同步失败")},2500);
    p.start();await flush();assert.equal(clock.timers.size,1);
    clock.advance(2500);await flush();assert.equal(calls,2);assert.equal(clock.timers.size,1);p.stop();
  }],
  ["Promise reject 后仍按周期恢复",async()=>{
    const {ctx,clock}=harness(),d=deferred();let calls=0;
    const p=new ctx.Poller(()=>{calls++;return calls===1?d.promise:Promise.resolve()},2500);
    p.start();await flush();d.reject(new Error("预期异步失败"));await flush();
    assert.equal(clock.timers.size,1);clock.advance(2500);await flush();assert.equal(calls,2);p.stop();
  }],
  ["旧请求 reject 后只接管最新重启",async()=>{
    const {ctx,clock}=harness(),d=deferred();let calls=0;
    const p=new ctx.Poller(()=>{calls++;return calls===1?d.promise:Promise.resolve()},2500);
    p.start();await flush();p.stop();p.start();await flush();assert.equal(calls,1);
    d.reject(new Error("预期旧请求失败"));await flush();
    assert.equal(calls,2);assert.equal(clock.timers.size,1);p.stop();
  }],
  ["hidden 不发送请求，恢复可见后继续",async()=>{
    const {ctx,clock,document}=harness();let calls=0;
    const p=new ctx.Poller(()=>{calls++},2500);
    document.hidden=true;p.start();await flush();assert.equal(calls,0);assert.equal(clock.timers.size,1);
    clock.advance(2500);await flush();assert.equal(calls,0);
    document.hidden=false;clock.advance(2500);await flush();assert.equal(calls,1);p.stop();
  }],
  ["微任务发送前再检查 hidden",async()=>{
    const {ctx,clock,document}=harness();let calls=0;
    const p=new ctx.Poller(()=>{calls++},2500);
    p.start();document.hidden=true;await flush();assert.equal(calls,0);assert.equal(clock.timers.size,1);p.stop();
  }],
  ["10 分钟 idle 暂停，用户输入后继续",async()=>{
    const {ctx,clock}=harness();let calls=0;
    const p=new ctx.Poller(()=>{calls++},2500);
    clock.advance(ctx.IDLE_STOP_MS+1);p.start();await flush();assert.equal(calls,0);
    ctx.lastInput=ctx.Date.now();clock.advance(2500);await flush();assert.equal(calls,1);p.stop();
  }],
  ["idle 边界恰好 10 分钟仍可执行",async()=>{
    const {ctx,clock}=harness();let calls=0;
    const p=new ctx.Poller(()=>{calls++},2500);
    clock.advance(ctx.IDLE_STOP_MS);p.start();await flush();assert.equal(calls,1);
    clock.advance(2500);await flush();assert.equal(calls,1);p.stop();
  }],
]){
  test("Poller: "+name,fn);
}

// ---------- 页面切换共享轮询 ----------
test("页面切换: dash → ports → vlan 共享轮询不叠加",async()=>{
  const requests=[];
  const {ctx,clock}=harness({
    eeePoller:{start(){},stop(){}},
    pollInfo:()=>Promise.resolve(),needPorts:fn=>fn(),
    buildPorts(){},portsMacs(){},buildVlanEdit(){},vlanRefresh:()=>Promise.resolve({vlan:[]}),
  },[...CORE,"10-dash.js","11-ports.js","12-vlan.js"]);
  ctx.l2Gen=0;
  // 真 Poller:dash/ports 两个 enter 共享它,start/stop 往返靠 busy/gen 不叠加。
  ctx.statusPoller=new ctx.Poller(()=>{const d=deferred();requests.push(d);return d.promise},2500);
  ctx.showTab("dash");await flush();ctx.showTab("ports");ctx.showTab("vlan");await flush();
  assert.equal(requests.length,1);
  requests[0].resolve();await flush();
  // vlan 不用 statusPoller:ports 的 leave 已把它停掉,旧请求结束后不再续拍。
  assert.equal(requests.length,1);
  ctx.showTab("ports");await flush();
  assert.equal(requests.length,2);
  requests[1].resolve();await flush();
  ctx.showTab("system");
  clock.advance(10000);await flush();
  assert.equal(requests.length,2);assert.equal(clock.timers.size,0);
});

// ---------- LAG 竞态 ----------
// 加载真实 04-status(needPorts 原样),用例只覆盖 pollStatus/buildLag/lagLoad。
function lagHarness(extra){
  return harness(extra,[...CORE,"04-status.js","14-links.js"]);
}
test("LAG: needPorts pending 时离页，旧 callback 不得 start",async()=>{
  const pending=[];let builds=0,loads=0;
  const {ctx,clock}=lagHarness({
    pollStatus:()=>{const d=deferred();pending.push(d);return d.promise},
    buildLag:()=>{builds++},lagLoad:()=>{loads++;return Promise.resolve()}});
  ctx.S.n=0;ctx.showTab("links");ctx.showTab("system");pending[0].resolve();await flush();
  assert.equal(builds,0);assert.equal(loads,0);assert.equal(clock.timers.size,0);
});
test("LAG: pending leave-return 后旧 callback 不能冒充新进入",async()=>{
  const pending=[];let builds=0,starts=0,loads=0;
  const {ctx,clock}=lagHarness({
    pollStatus:()=>{const d=deferred();pending.push(d);return d.promise},
    buildLag:()=>{builds++},lagLoad:()=>{loads++;return Promise.resolve()}});
  const start=ctx.lagPoller.start;
  ctx.lagPoller.start=function(){starts++;return start.call(this)};
  ctx.S.n=0;ctx.showTab("links");ctx.showTab("system");ctx.showTab("links");
  ctx.S.n=1;pending[1].resolve();await flush();pending[0].resolve();await flush();
  // 同页的 stpPoller 也在跑:结束时 lag + stp 各一个 timer。
  assert.equal(builds,1);assert.equal(starts,1);assert.equal(loads,1);assert.equal(clock.timers.size,2);
  ctx.showTab("system");
});
test("LAG: 快速离页重返等待已开始的 lagLoad",async()=>{
  const requests=[];
  const {ctx,clock}=lagHarness({lagLoad:()=>{const d=deferred();requests.push(d);return d.promise}});
  ctx.showTab("links");await flush();ctx.showTab("system");ctx.showTab("links");await flush();
  assert.equal(requests.length,1);requests[0].resolve();await flush();assert.equal(requests.length,2);
  requests[1].resolve();await flush();assert.equal(clock.timers.size,2);ctx.showTab("system");
});

// ---------- 计数器 modal ----------
const countersFile="11-ports.js";
for(const route of ["×","遮罩","底部按钮","替换弹窗","离页","同页重新进入"]){
  test("计数器 modal: "+route+" 清理 owner，不再轮询",async()=>{
    let requests=0;
    const {ctx,clock,el}=harness({
      getJSON:()=>{requests++;return Promise.resolve([])},
      // "同页重新进入"/"离页"路由会切到 ports 页,补齐其 enter 依赖。
      statusPoller:{start(){},stop(){}},eeePoller:{start(){},stop(){}},needPorts:()=>{},
    },[...CORE,countersFile]);
    ctx.showCounters(0);await flush();
    const poll=ctx.ctrPoll;let stops=0;const stop=poll.stop;
    poll.stop=function(){stops++;return stop.call(this)};
    const auto=descendants(el("mbody"),"input")[1];auto.checked=true;
    clock.advance(2500);await flush();assert.equal(requests,2);
    if(route==="×")el("mx").emit("click");
    if(route==="遮罩")el("mback").emit("click");
    if(route==="底部按钮")el("mfoot").children[1].emit("click");
    if(route==="替换弹窗")ctx.modal("replacement",ctx.h("div"));
    if(route==="离页")ctx.showTab("system");
    if(route==="同页重新进入")ctx.showTab("ports");
    assert.equal(poll.on,false);assert.equal(stops,1);assert.equal(ctx.ctrPoll,null);
    ctx.closeModal();assert.equal(stops,1);
    clock.advance(10000);await flush();assert.equal(requests,2);assert.equal(clock.timers.size,0);
  });
}
test("计数器 modal: 遮罩内部点击不能关闭 owner",async()=>{
  const {ctx,clock,el}=harness({},[...CORE,countersFile]);
  ctx.showCounters(0);await flush();el("mback").emit("click",{target:el("mbody")});
  assert.equal(ctx.ctrPoll.on,true);assert.equal(el("mback").classList.contains("show"),true);
  assert.equal(clock.timers.size,1);ctx.closeModal();
});
test("计数器 modal: 先清旧再注册新，不误停新实例",async()=>{
  const {ctx,clock,el}=harness({},[...CORE,countersFile]);
  ctx.showCounters(0);await flush();const old=ctx.ctrPoll;
  ctx.showCounters(1);const fresh=ctx.ctrPoll;await flush();
  assert.notEqual(old,fresh);assert.equal(old.on,false);assert.equal(fresh.on,true);assert.equal(clock.timers.size,1);
  const auto=descendants(el("mbody"),"input")[1];auto.checked=true;
  clock.advance(2500);await flush();assert.equal(fresh.on,true);assert.equal(clock.timers.size,1);
  ctx.closeModal();assert.equal(fresh.on,false);assert.equal(ctx.ctrPoll,null);
});
test("计数器 modal: 关闭后 pending GET 允许完成，但不复活 timer",async()=>{
  const d=deferred();let requests=0;
  const {ctx,clock}=harness({getJSON:()=>{requests++;return d.promise}},[...CORE,countersFile]);
  ctx.showCounters(0);ctx.closeModal();await flush();d.resolve([]);await flush();
  assert.equal(requests,1);assert.equal(clock.timers.size,0);
});
for(const route of ["关闭后成功","替换后成功","关闭后失败"]){
  test("计数器 modal: "+route+" 的旧 GET 不写过期 owner",async()=>{
    const pending=[];
    const {ctx,el}=harness({getJSON:()=>{const d=deferred();pending.push(d);return d.promise}},[...CORE,countersFile]);
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
  const {ctx,el}=harness({getJSON:()=>{requests++;return Promise.resolve([])}},[...CORE,countersFile]);
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

// ---------- API 队列 ----------
function networkHarness(){
  const requests=[];
  const env=harness({fetch:(url,opts)=>{
    const headers=deferred(),body=deferred();requests.push({url,opts,headers,body});return headers.promise;
  }},CORE);
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

// ---------- SFP DDM ----------
function sfpPort(extra={}){
  return {portNum:9,isSFP:true,enabled:1,link:0,txG:"0x0",txB:"0x0",rxG:"0x0",rxB:"0x0",
    sfp_vendor:"vendor",sfp_options:0x40,sfp_temp:"0x0000",sfp_vcc:"0x0000",sfp_txbias:"0x0000",
    sfp_txpower:"0x0000",sfp_rxpower:"0x0000",sfp_state:"0x00",...extra};
}
const sfpFiles=[...CORE,"03-sfp.js"];
test("SFP: 不完整/错误 DDM hex 不得位运算成零",()=>{
  const {ctx}=harness({},sfpFiles);
  for(const value of [undefined,null,"","0x","0xzz","0x1234z"]){
    assert.ok(Number.isNaN(ctx.pU16(value)),"pU16 应拒绝 "+value);
    assert.ok(Number.isNaN(ctx.pI16(value)),"pI16 应拒绝 "+value);
  }
  assert.equal(ctx.pU16("0xffff"),65535);assert.equal(ctx.pI16("0xffff"),-1);
  assert.equal(ctx.pI16("0x8000"),-32768);assert.equal(ctx.pI16("0x0000"),0);
});
test("SFP: detail 中 DDM 读取失败显示不可用而非零",()=>{
  const {ctx}=harness({},sfpFiles);
  const rows=ctx.portRows(sfpPort({sfp_temp:"0x",sfp_vcc:"0x",sfp_txbias:"0x",sfp_txpower:"0x",sfp_rxpower:"0x"}));
  for(const key of ["p_temp","p_vcc","p_txbias","p_txpower","p_rxpower"]){
    assert.equal(rows.find(r=>r[0]===ctx.t(key))[1],"-",key);
  }
});
function dashSfpVals(ctx,el){
  ctx.dashSfp();
  return descendants(el("dsfpcards"),"div").filter(e=>e.classList.contains("sens"))
    .map(e=>e.children[0].textContent);
}
test("SFP: dashboard 中 DDM 读取失败显示不可用",()=>{
  const {ctx,el}=harness({},[...CORE,"03-sfp.js","10-dash.js"]);
  ctx.S.ports=[sfpPort({sfp_temp:"0x",sfp_vcc:"0x",sfp_txpower:"0x",sfp_rxpower:"0x"})];
  assert.deepEqual(dashSfpVals(ctx,el),["-","-","-","-"]);
});
test("SFP: state 无效不能伪装 TX fault/disable 或模块 LOS 为否",()=>{
  const {ctx}=harness({},sfpFiles);
  const rows=ctx.portRows(sfpPort({sfp_state:"0x",sfp_los:1}));
  assert.equal(rows.find(r=>r[0]===ctx.t("p_txfault"))[1],"-");
  assert.equal(rows.find(r=>r[0]===ctx.t("p_txdis"))[1],"-");
  assert.equal(rows.find(r=>r[0]===ctx.t("p_rxlos"))[1],ctx.t("c_yes"));
});
test("SFP: 缺少可选 calibration 的旧字段仍支持真实零值",()=>{
  const {ctx}=harness({},sfpFiles);
  const rows=ctx.portRows(sfpPort());
  assert.equal(rows.find(r=>r[0]===ctx.t("p_temp"))[1],"0.0 °C");
  assert.equal(rows.find(r=>r[0]===ctx.t("p_vcc"))[1],"0.00 V");
  assert.equal(rows.find(r=>r[0]===ctx.t("p_txpower"))[1],"0.000 mW / -40.00 dBm");
});
test("SFP: enabled 仅代表 admin，metadata 未 ready 不冒充 module present",()=>{
  const {ctx,el}=harness({},[...CORE,"03-sfp.js","10-dash.js"]);
  const p={portNum:9,isSFP:true,enabled:1,link:0,txG:"0x0",txB:"0x0",rxG:"0x0",rxB:"0x0",sfp_los:1};
  const rows=ctx.portRows(p);
  assert.equal(rows.find(r=>r[0]===ctx.t("p_state"))[1],ctx.t("c_down"));
  assert.equal(rows.some(r=>r[0]===ctx.t("p_module")||r[0]===ctx.t("p_temp")),false);
  ctx.S.ports=[sfpPort()];assert.equal(dashSfpVals(ctx,el).length,4);
  ctx.S.ports=[p];ctx.dashSfp();assert.equal(el("dsfpcards").style.display,"none");
});
test("SFP: vendor 有而 options 缺失不读取 DDM",()=>{
  const {ctx,el}=harness({},[...CORE,"03-sfp.js","10-dash.js"]);
  const p=sfpPort({sfp_options:undefined});
  assert.equal(ctx.portRows(p).some(r=>r[0]==="p_temp"),false);
  ctx.S.ports=[p];assert.equal(dashSfpVals(ctx,el).length,0);
});
test("SFP: 混合无效数据只将失败测项显示不可用",()=>{
  const {ctx}=harness({},sfpFiles);
  const rows=ctx.portRows(sfpPort({sfp_temp:"0x",sfp_txpower:"0x",sfp_vcc:"0x2710"}));
  assert.equal(rows.find(r=>r[0]===ctx.t("p_temp"))[1],"-");
  assert.equal(rows.find(r=>r[0]===ctx.t("p_txpower"))[1],"-");
  assert.equal(rows.find(r=>r[0]===ctx.t("p_vcc"))[1],"1.00 V");
});
test("SFP: 无效 calibration 不得伪装有效读数",()=>{
  const {ctx}=harness({},sfpFiles);
  assert.ok(Number.isNaN(ctx.calSO(256,"0x")));
  assert.ok(Number.isNaN(ctx.calRx(123,"0x"+"g".repeat(40))));
  assert.equal(ctx.calSO(256,"0x01000000"),256);
  assert.equal(ctx.calRx(123,"0x0000000000000000000000003f80000000000000"),123);
});

// ---------- 配置合并(CONF_RULES 单一来源) ----------
const cfgFiles=[...CORE,"02-config.js"];
test("CONF_RULES: isConfCmd 覆盖写配置命令、排除运行时命令",()=>{
  const {ctx}=harness({},cfgFiles);
  for(const line of ["ip 192.168.1.1","ip dhcp","port 3 on","port 3 name up","mtu 3 9000",
    "vlan 100 3t","vlan 100 d","pvid 3 100","eee on 3","mirror off","lag 2 lacp 3 4",
    "laghash 2 spa","stp on","stp port 3 edge auto","storm 3 bcast 100 pps","syslog off"]){
    assert.equal(ctx.isConfCmd(line),true,line);
  }
  for(const line of ["sfp 1 2g5","l2 forget","port 3 name","bogus",""]){
    assert.equal(ctx.isConfCmd(line),false,line);
  }
});
test("mergeConf: ip/gw 覆写保留其他行(覆写行移到尾部)",()=>{
  const {ctx}=harness({},cfgFiles);
  const out=ctx.mergeConf(["hostname sw","ip 10.0.0.1","gw 10.0.0.254"],["ip 10.0.0.2"]);
  assert.deepEqual(out,["hostname sw","gw 10.0.0.254","ip 10.0.0.2"]);
});
test("mergeConf: vlan d 删除该 VLAN 全部行",()=>{
  const {ctx}=harness({},cfgFiles);
  const out=ctx.mergeConf(["vlan 100 3t","pvid 3 100","vlan 200 4t"],["vlan 100 d"]);
  assert.deepEqual(out,["pvid 3 100","vlan 200 4t"]);
});
test("mergeConf: ingress 增量合并并按端口排序(reset 之后的行参与合并)",()=>{
  const {ctx}=harness({},cfgFiles);
  const out=ctx.mergeConf(["ingress a","ingress 3u 4t"],["ingress 2u"]);
  assert.deepEqual(out,["ingress a","ingress 2u 3u 4t"]);
});
test("mergeConf: ingress a 清空并重启过滤状态",()=>{
  const {ctx}=harness({},cfgFiles);
  const out=ctx.mergeConf(["ingress 3u 4t"],["ingress a"]);
  assert.deepEqual(out,["ingress a"]);
});
test("mergeConf: bw 动作替换旧动作、off 以命令形式入表",()=>{
  const {ctx}=harness({},cfgFiles);
  // 限速与动作是两条独立命令:数值行保留,fc→drop 只替换动作行。
  const out=ctx.mergeConf(["bw in 3 03e8","bw in 3 fc"],["bw in 3 drop"]);
  assert.deepEqual(out,["bw in 3 03e8","bw in 3 drop"]);
  const out2=ctx.mergeConf(["bw out 4 03e8"],["bw out 4 off"]);
  assert.deepEqual(out2,["bw out 4 off"]);
});
test("mergeConf: on/off toggle 替换旧行",()=>{
  const {ctx}=harness({},cfgFiles);
  const out=ctx.mergeConf(["syslog on","stp port 3 on"],["syslog off","stp port 3 off"]);
  assert.deepEqual(out,["syslog off","stp port 3 off"]);
});
test("mergeConf: eee 全局与单端口各自覆写",()=>{
  const {ctx}=harness({},cfgFiles);
  const out=ctx.mergeConf(["eee on","eee on 3","eee off 4"],["eee off","eee on 4"]);
  assert.deepEqual(out,["eee off","eee on 4"]);
});
test("mergeConf: lag d 连带 laghash，lacp off 连带 lacp 行",()=>{
  const {ctx}=harness({},cfgFiles);
  const out=ctx.mergeConf(["lag 2 lacp 3 4","laghash 2 spa"],["lag 2 d"]);
  assert.deepEqual(out,[]);
  const out2=ctx.mergeConf(["lag 2 lacp 3 4"],["lag 2 lacp off"]);
  assert.deepEqual(out2,[]);
});
test("mergeConf: mirror off 清掉镜像配置，port name 与速率互不覆写",()=>{
  const {ctx}=harness({},cfgFiles);
  const out=ctx.mergeConf(["mirror 6 2r"],["mirror off"]);
  assert.deepEqual(out,[]);
  const out2=ctx.mergeConf(["port 3 2g5","port 3 name up"],["port 3 1g"]);
  assert.deepEqual(out2,["port 3 name up","port 3 1g"]);
});

// ---------- i18n ----------
test("i18n: en 与 zh 键集完全一致",()=>{
  const {ctx}=harness({},["00-i18n.js"]);
  const en=Object.keys(ctx.LANG.en).sort(),zh=Object.keys(ctx.LANG.zh).sort();
  assert.deepEqual(zh.filter(k=>!ctx.LANG.en[k]),[]);
  assert.deepEqual(en.filter(k=>!ctx.LANG.zh[k]),[]);
  assert.equal(ctx.rtlLang,"en");
  assert.equal(ctx.t("c_apply"),"Apply");
});

// ---------- 启动序列 ----------
test("Boot: 全部分片加载，旧 hash 映射到合并后的页面",()=>{
  const {ctx,el}=harness({
    pollInfo:()=>Promise.resolve(),
    getText:()=>Promise.reject(new Error("无命令日志")),
    getJSON:()=>Promise.resolve([]),
  },ALL,"#stp");
  assert.ok(el("nv-links").classList.contains("act"));
  assert.equal(el("ttitle").textContent,"Links");
  assert.equal(ctx.curTab,"links");
  assert.equal(ctx.TABS.length,7);
});
