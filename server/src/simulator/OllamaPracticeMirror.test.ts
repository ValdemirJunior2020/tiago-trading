import{describe,it,expect,afterEach}from'vitest'
import{mkdtempSync,rmSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{OllamaPracticeMirror}from'./OllamaPracticeMirror.js'
import type{BrokerSignal}from'./OllamaPaperEngine.js'
import{OLLAMA_TRADE_TAG,isTagged,ollamaClientId}from'../broker/OllamaPracticeBroker.js'

const dirs:string[]=[]
const now=()=>new Date()
let sequence=0
const signal=():BrokerSignal=>({
 key:'EUR_USD:2026-10-09T19:00:00.000Z:long:'+ ++sequence,action:'OPEN',symbol:'EUR_USD',
 direction:'long',entry:'1.10000',stop:'1.09860',target:'1.10280',units:'1500',
 at:now().toISOString(),candleTime:now().toISOString(),confidence:.91
})
const trade=(id:string,cid:string,tag=OLLAMA_TRADE_TAG,state='OPEN')=>({
 id,instrument:'EUR_USD',state,currentUnits:'1500',price:'1.10001',
 unrealizedPL:'0.51',realizedPL:'2.13',stopLossOrder:{price:'1.09860'},clientExtensions:{id:cid,tag}
})
function harness(existing:BrokerSignal|null=null){
 const dir=mkdtempSync(join(tmpdir(),'ollama-oanda-only-'));dirs.push(dir)
 let view:{lastBrokerSignal:BrokerSignal|null;position?:unknown}={lastBrokerSignal:existing}
 let shadow:{position:{symbol:string}|null}={position:null}
 const trades:ReturnType<typeof trade>[]=[]
 const calls={open:0,close:0,stop:0,validate:0,find:0}
 let captured:Record<string,unknown>|null=null
 const broker={
  validateOpen:async(spec:Record<string,unknown>,shadowSymbol:string|null)=>{
   calls.validate++;if(shadowSymbol==='EUR_USD')throw Error('SHADOW_PRIORITY')
   if(!spec.target)throw Error('Missing OANDA take-profit')
  },
  openTrades:async()=>trades.filter(x=>x.state==='OPEN'),
  findTagged:async(clientId:string)=>{calls.find++;return trades.filter(x=>x.clientExtensions.id===clientId)},
  open:async(spec:Record<string,any>)=>{
   calls.open++;captured=spec
   trades.push(trade('91',spec.clientId))
   return{tradeId:'91',fillPrice:'1.10001',transactionId:'90'}
  },
  trade:async(id:string)=>trades.find(x=>x.id===id)||null,
  syncStop:async()=>{calls.stop++;throw Error('Unexpected stop change in broker-only mode')},
  close:async()=>{calls.close++;throw Error('Unexpected artificial paper closure')}
 }
 const mirror=new OllamaPracticeMirror(()=>view,()=>shadow,{baseDir:dir,logDir:join(dir,'logs'),broker:broker as any,now})
 return{mirror,calls,dir,trades,broker,captured:()=>captured,show:(s:BrokerSignal|null)=>{view={lastBrokerSignal:s}},
  setShadow:(s:string|null)=>{shadow={position:s?{symbol:s}:null}},
  setOldPaper:()=>{view={lastBrokerSignal:null,position:{symbol:'EUR_USD',openedAt:now().toISOString()}}}}
}
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})})
describe('Ollama OANDA Practice direct execution, no virtual mirroring',()=>{
 it('does not execute a signal already present at startup',async()=>{
  const h=harness(signal())
  await h.mirror.checkNow();await h.mirror.checkNow()
  expect(h.calls.open).toBe(0)
  expect(h.mirror.snapshot().status).toBe('WAITING_NEW_OLLAMA_SIGNAL')
 })
 it('ignores ALL historical virtual paper positions forever',async()=>{
  const h=harness()
  await h.mirror.checkNow();h.setOldPaper();await h.mirror.checkNow()
  expect(h.calls.open).toBe(0)
  expect(h.calls.close).toBe(0)
 })
 it('submits a fresh AI signal exactly once with stop and target and an OANDA Trade ID',async()=>{
  const h=harness()
  await h.mirror.checkNow()
  h.show(signal());await h.mirror.checkNow();await h.mirror.checkNow()
  expect(h.calls.open).toBe(1)
  expect(h.captured()?.target).toBe('1.10280')
  expect(h.mirror.snapshot().tradeId).toBe('91')
  expect(h.mirror.snapshot().status).toBe('BROKER_OPEN')
  expect(h.mirror.snapshot().realizedPL).toBe('0.00')
  expect(h.mirror.snapshot().brokerOpenPL).toBe('0.51')
 })
 it('persists Trade ID through a restart, never reopens and obtains profit only after OANDA closed trade',async()=>{
  const h=harness()
  await h.mirror.checkNow()
  const s=signal();h.show(s);await h.mirror.checkNow()
  const again=new OllamaPracticeMirror(()=>({lastBrokerSignal:s}),()=>({position:null}),{
   baseDir:h.dir,logDir:join(h.dir,'logs'),broker:h.broker as any,now})
  await again.checkNow();await again.checkNow()
  expect(h.calls.open).toBe(1)
  expect(again.snapshot().tradeId).toBe('91')
  h.trades[0].state='CLOSED'
  await again.checkNow()
  expect(again.snapshot().realizedPL).toBe('2.13')
  expect(again.snapshot().closedTrades).toBe(1)
  expect(h.calls.close).toBe(0)
  expect(h.calls.open).toBe(1)
 })
 it('refuses to mutate an open Shadow trade when Ollama ownership tag changes',async()=>{
  const h=harness()
  await h.mirror.checkNow();h.show(signal());await h.mirror.checkNow()
  h.trades[0].clientExtensions.tag='SHADOW_3_4'
  await h.mirror.checkNow()
  expect(h.calls.close).toBe(0);expect(h.calls.stop).toBe(0)
  expect(h.mirror.snapshot().status).toBe('REVIEW_REQUIRED')
 })
 it('blocks Ollama when Shadow already occupies the same instrument',async()=>{
  const h=harness()
  await h.mirror.checkNow();h.setShadow('EUR_USD');h.show(signal())
  await h.mirror.checkNow()
  expect(h.calls.open).toBe(0)
  expect(h.mirror.snapshot().status).toBe('BLOCKED')
  expect(h.mirror.snapshot().latestError).toContain('SHADOW_PRIORITY')
 })
 it('treats broker timeout after fill as ambiguous; never duplicates; can reconcile read-only',async()=>{
  const h=harness()
  await h.mirror.checkNow()
  const original=h.broker.open
  h.broker.open=async(spec:any)=>{await original(spec);throw Error('OANDA response timed out AFTER fill')}
  h.show(signal());await h.mirror.checkNow()
  expect(h.calls.open).toBe(1)
  expect(h.mirror.snapshot().status).toBe('REVIEW_REQUIRED')
  await h.mirror.checkNow()
  expect(h.calls.open).toBe(1)
  await h.mirror.reconcileOnly()
  expect(h.mirror.snapshot().status).toBe('BROKER_OPEN')
  expect(h.mirror.snapshot().tradeId).toBe('91')
  expect(h.calls.open).toBe(1)
 })
 it('uses deterministic unique client IDs distinct from Shadow',()=>{
  expect(ollamaClientId('A','EUR_USD')).toBe(ollamaClientId('A','EUR_USD'))
  expect(ollamaClientId('A','EUR_USD')).not.toBe(ollamaClientId('B','EUR_USD'))
  expect(isTagged(trade('11','abc'),'abc')).toBe(true)
  expect(isTagged(trade('11','abc','SHADOW_3_4'),'abc')).toBe(false)
 })
})
