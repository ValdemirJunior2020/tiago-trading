import{describe,it,expect,afterEach}from'vitest'
import{mkdtempSync,rmSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{OllamaPracticeMirror}from'./OllamaPracticeMirror.js'
import{OLLAMA_TRADE_TAG,isTagged,ollamaClientId}from'../broker/OllamaPracticeBroker.js'

const dirs:string[]=[]
const now=()=>new Date()
const pos=()=>({symbol:'EUR_USD',direction:'long' as const,entry:'1.10000',units:'1500',stop:'1.09860',openedAt:now().toISOString()})
const trade=(id:string,cid:string,tag=OLLAMA_TRADE_TAG,state='OPEN')=>({
 id,instrument:'EUR_USD',state,currentUnits:'1500',price:'1.10001',
 realizedPL:'2.13',stopLossOrder:{price:'1.09860'},clientExtensions:{id:cid,tag}
})
function harness(initial:ReturnType<typeof pos>|null=null){
 const dir=mkdtempSync(join(tmpdir(),'ollama-oanda-mirror-test-'));dirs.push(dir)
 let paper=initial, shadow:{position:{symbol:string}|null}={position:null}
 const openTrades:ReturnType<typeof trade>[]=[]
 const calls={open:0,close:0,stop:0,validate:0,find:0}
 const broker={
  validateOpen:async (_spec:unknown,shadowSymbol:string|null)=>{calls.validate++;if(shadowSymbol==='EUR_USD')throw Error('SHADOW_PRIORITY')},
  openTrades:async()=>openTrades.filter(x=>x.state==='OPEN'),
  findTagged:async(clientId:string)=>{calls.find++;return openTrades.filter(x=>x.clientExtensions.id===clientId)},
  open:async(spec:{clientId:string})=>{calls.open++;openTrades.push(trade('91',spec.clientId));return{tradeId:'91',fillPrice:'1.10001',transactionId:'90'}},
  trade:async(id:string)=>openTrades.find(x=>x.id===id)||null,
  syncStop:async(id:string,clientId:string,_symbol:string,stop:string)=>{
   calls.stop++;const t=openTrades.find(x=>x.id===id)!
   if(!isTagged(t,clientId))throw Error('ownership mismatch')
   t.stopLossOrder.price=stop;return{price:stop,transactionId:'93'}
  },
  close:async(id:string,clientId:string)=>{calls.close++;const t=openTrades.find(x=>x.id===id)!
   if(!isTagged(t,clientId))throw Error('ownership mismatch')
   t.state='CLOSED';return{tradeId:id,realizedPL:'2.13',alreadyClosed:false}}
 }
 const mirror=new OllamaPracticeMirror(()=>({position:paper}),()=>shadow,{baseDir:dir,logDir:join(dir,'logs'),broker:broker as any,now})
 return {mirror,calls,dir,openTrades,setPaper:(p:ReturnType<typeof pos>|null)=>{paper=p},
  setShadow:(symbol:string|null)=>{shadow={position:symbol?{symbol}:null}},broker}
}
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})})
describe('single-account independent Ollama Practice ownership',()=>{
 it('never retroactively sends an already existing Ollama paper position to OANDA',async()=>{
  const h=harness(pos())
  await h.mirror.checkNow()
  await h.mirror.checkNow()
  expect(h.calls.open).toBe(0)
  expect(h.mirror.snapshot().status).toBe('WAITING_NEW_PAPER_SIGNAL')
 })
 it('mirrors only the NEXT paper trade once and binds official tagged Trade ID',async()=>{
  const h=harness()
  await h.mirror.checkNow()
  h.setPaper(pos())
  await h.mirror.checkNow();await h.mirror.checkNow()
  expect(h.calls.open).toBe(1)
  expect(h.mirror.snapshot().tradeId).toBe('91')
  expect(h.mirror.snapshot().status).toBe('BROKER_OPEN')
  expect(h.mirror.snapshot().realizedPL).toBe('0.00')
 })
 it('restarts without placing duplicate orders and closes only its owned trade',async()=>{
  const h=harness()
  await h.mirror.checkNow();h.setPaper(pos());await h.mirror.checkNow()
  const again=new OllamaPracticeMirror(()=>({position:h.mirror.snapshot().activeSymbol?null:null}),()=>({position:null}),{
   baseDir:h.dir,logDir:join(h.dir,'logs'),broker:h.broker as any,now})
  await again.checkNow()
  expect(h.calls.open).toBe(1)
  expect(h.calls.close).toBe(1)
  expect(again.snapshot().realizedPL).toBe('2.13')
  expect(again.snapshot().closedTrades).toBe(1)
 })
 it('refuses to act on a broker trade whose tag is not owned by Ollama',async()=>{
  const h=harness()
  await h.mirror.checkNow();h.setPaper(pos());await h.mirror.checkNow()
  h.openTrades[0].clientExtensions.tag='SHADOW_3_4'
  h.setPaper(null);await h.mirror.checkNow()
  expect(h.calls.close).toBe(0)
  expect(h.mirror.snapshot().status).toBe('REVIEW_REQUIRED')
 })
 it('prevents an Ollama broker entry when Shadow currently has that instrument',async()=>{
  const h=harness()
  await h.mirror.checkNow();h.setShadow('EUR_USD');h.setPaper(pos())
  await h.mirror.checkNow()
  expect(h.calls.open).toBe(0)
  expect(h.mirror.snapshot().status).toBe('BLOCKED')
  expect(h.mirror.snapshot().latestError).toContain('SHADOW_PRIORITY')
 })
 it('uses unique deterministic Ollama client IDs and never confuses tags',()=>{
  expect(ollamaClientId('A','EUR_USD')).toBe(ollamaClientId('A','EUR_USD'))
  expect(ollamaClientId('A','EUR_USD')).not.toBe(ollamaClientId('B','EUR_USD'))
  expect(isTagged(trade('11','abc'), 'abc')).toBe(true)
  expect(isTagged(trade('11','abc','SHADOW_3_4'), 'abc')).toBe(false)
 })
 it('syncs only tighter virtual stops on its independently tagged broker trade',async()=>{
  const h=harness()
  await h.mirror.checkNow()
  const p=pos();h.setPaper(p);await h.mirror.checkNow()
  h.setPaper({...p,stop:'1.09900'});await h.mirror.checkNow()
  expect(h.calls.stop).toBe(1)
  expect(h.mirror.snapshot().mirroredStop).toBe('1.09900')
  h.setPaper({...p,stop:'1.09700'});await h.mirror.checkNow()
  expect(h.calls.stop).toBe(1)
 })
})
