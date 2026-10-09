import {appendFileSync,mkdirSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import type {OandaReadOnly} from '../broker/OandaReadOnly.js'
import {env} from '../config.js'
import {ShadowMemory} from './ShadowMemory.js'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../')
type Decision={decision:'LONG'|'SHORT'|'WAIT';confidence:number;reason:string}
type Entry={at:string;symbol:string;decision:string;confidence:number;reason:string;lossExamples:number;compare:string}
type Options={memory?:ShadowMemory;advisor?:(input:unknown)=>Promise<Decision>;logFile?:string}
type Broker=Pick<OandaReadOnly,'quote'|'candles'>
export async function askMemoryAdvisor(input:unknown):Promise<Decision>{
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),10000)
 try{
  const r=await fetch(env.OLLAMA_BASE_URL+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:ac.signal,body:JSON.stringify({
   model:env.OLLAMA_MODEL,stream:false,think:false,format:'json',options:{temperature:0,num_predict:210},
   messages:[
    {role:'system',content:'You are a research-only AI comparing present forex conditions with real completed Shadow strategy trade results. Historical losses are examples, NOT proof that similar trades lose again. Respond ONLY JSON {"decision":"LONG|SHORT|WAIT","confidence":0..1,"reason":"brief evidence and uncertainty"}. Never submit orders; no real trades; never invent outcomes or prices.'},
    {role:'user',content:JSON.stringify(input)}
   ]
  })})
  if(!r.ok)throw Error('Ollama HTTP '+r.status)
  const body=await r.json() as {message?:{content?:string}},o=JSON.parse(body.message?.content||'{}')
  if(!['LONG','SHORT','WAIT'].includes(o.decision)||typeof o.confidence!=='number'||o.confidence<0||o.confidence>1||typeof o.reason!=='string')throw Error('Bad memory AI response')
  return{decision:o.decision,confidence:o.confidence,reason:o.reason.slice(0,350)}
 }finally{clearTimeout(timer)}
}
export class ShadowMemoryResearch{
 private readonly memory:ShadowMemory
 private readonly advisor:(input:unknown)=>Promise<Decision>
 private readonly logFile:string
 private seen=new Set<string>()
 private status={decisions:0,warnings:0,errors:0,lastDecision:null as Entry|null,recent:[] as Entry[],mode:'OBSERVATION_ONLY',openViking:'OFFLINE'}
 constructor(private broker:Broker,opts:Options={}){
  this.memory=opts.memory||new ShadowMemory()
  this.advisor=opts.advisor||askMemoryAdvisor
  this.logFile=opts.logFile||resolve(root,'logs/ollama-memory/advice.jsonl')
 }
 snapshot(){return{...this.status,memory:this.memory.snapshot()}}
 async refresh(){const m=await this.memory.sync();this.status.openViking=m.openViking}
 async process(symbol:string){
  if(!['EUR_USD','GBP_USD'].includes(symbol))return
  try{
   const [q,m5,m10]=await Promise.all([this.broker.quote(symbol),this.broker.candles(symbol,'M5',26),this.broker.candles(symbol,'M10',21)])
   const last=m5.at(-1);if(!last||m5.length<25||m10.length<20)return
   const key=symbol+last.time;if(this.seen.has(key))return
   this.seen.add(key)
   if(this.seen.size>300)this.seen=new Set([...this.seen].slice(-150))
   const lossLong=this.memory.getLosses(symbol,'LONG',Number(q.ask))
   const lossShort=this.memory.getLosses(symbol,'SHORT',Number(q.bid))
   const input={symbol,quote:q,m5:m5.slice(-15),m10:m10.slice(-12),shadowLessons:{longLosses:lossLong,shortLosses:lossShort},disclaimer:'Historical similarity by pair, side and entry price is a weak indicator, not proof. We do not have reliable full entry indicators for all archived trades.'}
   const d=await this.advisor(input)
   const warning=(d.decision==='LONG'&&lossLong.length>0)||(d.decision==='SHORT'&&lossShort.length>0)
   const entry:Entry={at:new Date().toISOString(),symbol,decision:d.decision,confidence:d.confidence,reason:d.reason,lossExamples:d.decision==='LONG'?lossLong.length:d.decision==='SHORT'?lossShort.length:0,compare:warning?'SIMILAR_SHADOW_LOSS_EXISTS':'NO_MATCHING_LOSS'}
   this.status.decisions++;if(warning)this.status.warnings++
   this.status.lastDecision=entry;this.status.recent=[entry,...this.status.recent].slice(0,10)
   mkdirSync(dirname(this.logFile),{recursive:true});appendFileSync(this.logFile,JSON.stringify({...entry,event:'OLLAMA_MEMORY_REVIEW',mode:'OBSERVATION_ONLY'})+'\n')
  }catch(e){
   this.status.errors++
   mkdirSync(dirname(this.logFile),{recursive:true});appendFileSync(this.logFile,JSON.stringify({at:new Date().toISOString(),event:'OLLAMA_MEMORY_ERROR',reason:String(e)})+'\n')
  }
 }
}
