import {existsSync,readFileSync,mkdirSync,appendFileSync,writeFileSync,renameSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../')
export type ShadowLesson={id:string;symbol:string;direction:string;entry:number;exit:number;pnl:number;closedAt:string;reason:string}
export type MemoryMatch={lesson:ShadowLesson;distance:number}
export type MemoryStatus={source:'SHADOW_CLOSED_TRADES';total:number;losses:number;wins:number;lastSync:string|null;openViking:'OFFLINE'|'SYNCED'|'ERROR';synced:number;lastError:string|null}
type Opts={tradeFile?:string;dataFile?:string;logFile?:string;endpoint?:string;fetcher?:typeof fetch}
const num=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:NaN}
export function parseShadowLessons(jsonl:string):ShadowLesson[]{
 const open=new Map<string,any>(),result:ShadowLesson[]=[],seen=new Set<string>()
 for(const line of jsonl.split(/\r?\n/)){
  if(!line.trim())continue
  let r:any;try{r=JSON.parse(line)}catch{continue}
  const event=String(r.event||'')
  if(event==='SHADOW_PAPER_OPEN'){if(r.symbol)open.set(String(r.symbol),r);continue}
  if(event!=='SHADOW_PAPER_CLOSE')continue
  const symbol=String(r.symbol||''),pnl=num(r.pnl),entry=num(r.entry),exit=num(r.exit)
  if(!/^[A-Z]{3}_[A-Z]{3}$/.test(symbol)||!Number.isFinite(pnl))continue
  const related=open.get(symbol)||{}
  const at=String(r.at||r.closedAt||'')
  const id=createHash('sha256').update(JSON.stringify([symbol,r.openedAt||'',at,r.pnl,r.units,r.reason])).digest('hex').slice(0,24)
  if(seen.has(id))continue
  seen.add(id)
  result.push({id,symbol,direction:String(r.direction||related.direction||'UNKNOWN').toUpperCase(),entry:Number.isFinite(entry)?entry:num(related.entry),exit,pnl,closedAt:at,reason:String(r.reason||'UNSPECIFIED')})
  open.delete(symbol)
 }
 return result.filter(x=>Number.isFinite(x.entry)&&Number.isFinite(x.exit))
}
export function similarShadowLosses(lessons:ShadowLesson[],symbol:string,side:string,price:number,limit=4):MemoryMatch[]{
 if(!Number.isFinite(price)||price<=0)return[]
 return lessons.filter(l=>l.pnl<0&&l.symbol===symbol&&l.direction===side.toUpperCase())
  .map(lesson=>({lesson,distance:Math.abs(lesson.entry-price)/price}))
  .sort((a,b)=>a.distance-b.distance).slice(0,Math.max(0,limit))
}
export class ShadowMemory{
 private lessons:ShadowLesson[]=[]
 private status:MemoryStatus={source:'SHADOW_CLOSED_TRADES',total:0,losses:0,wins:0,lastSync:null,openViking:'OFFLINE',synced:0,lastError:null}
 private readonly tradeFile:string
 private readonly fallbackTradeFile:string|null
 private readonly dataFile:string
 private readonly logFile:string
 private readonly endpoint:string
 private readonly fetcher:typeof fetch
 private readonly already=new Set<string>()
 constructor(opts:Opts={}){
  this.tradeFile=opts.tradeFile||resolve(root,'logs/history/shadow-paper-trades.jsonl')
  this.fallbackTradeFile=opts.tradeFile?null:resolve(root,'logs/shadow-paper/trades.jsonl')
  this.dataFile=opts.dataFile||resolve(root,'data/ollama-shadow-memory-state.json')
  this.logFile=opts.logFile||resolve(root,'logs/ollama-memory/events.jsonl')
  this.endpoint=(opts.endpoint||'http://127.0.0.1:1933').replace(/\/$/,'')
  this.fetcher=opts.fetcher||fetch
  if(existsSync(this.dataFile)){try{const s=JSON.parse(readFileSync(this.dataFile,'utf8'));if(Array.isArray(s.syncedIds))for(const id of s.syncedIds)this.already.add(id)}catch{/* never overwrite corrupted state */}}
 }
 snapshot(){return{...this.status,examples:this.lessons.filter(x=>x.pnl<0).slice(-4).reverse()}}
 getLosses(symbol:string,side:string,price:number){return similarShadowLosses(this.lessons,symbol,side,price)}
 private log(event:string,extra:Record<string,unknown>){
  mkdirSync(dirname(this.logFile),{recursive:true})
  appendFileSync(this.logFile,JSON.stringify({at:new Date().toISOString(),event,...extra})+'\n')
 }
 async sync(){
  const file=existsSync(this.tradeFile)?this.tradeFile:(this.fallbackTradeFile&&existsSync(this.fallbackTradeFile)?this.fallbackTradeFile:null)
  if(!file){this.status.lastSync=new Date().toISOString();return this.snapshot()}
  const next=parseShadowLessons(readFileSync(file,'utf8'))
  this.lessons=next
  this.status={...this.status,total:next.length,losses:next.filter(x=>x.pnl<0).length,wins:next.filter(x=>x.pnl>0).length,lastSync:new Date().toISOString()}
  this.log('SHADOW_MEMORY_SCANNED',{total:next.length,losses:this.status.losses})
  // Optional OpenViking sidecar: no writes to Shadow, OANDA, or original AI state.
  try{
   const health=await this.fetcher(this.endpoint+'/health',{signal:AbortSignal.timeout(1200)})
   if(!health.ok)throw Error('OpenViking not available')
   let done=0
   for(const lesson of next.filter(x=>!this.already.has(x.id)).slice(0,4)){
    const uri='viking://resources/tiago-shadow/'+lesson.id+'.md'
    const body={uri,content:'# Shadow completed trade\n'+JSON.stringify(lesson,null,2),mode:'replace',tags:['project=tiago','strategy=shadow']}
    const r=await this.fetcher(this.endpoint+'/api/v1/content/write',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(4000)})
    if(!r.ok)throw Error('OpenViking write HTTP '+r.status)
    this.already.add(lesson.id);done++
   }
   if(done){mkdirSync(dirname(this.dataFile),{recursive:true});const tmp=this.dataFile+'.tmp';writeFileSync(tmp,JSON.stringify({version:1,syncedIds:[...this.already]},null,2));renameSync(tmp,this.dataFile)}
   this.status.openViking='SYNCED';this.status.synced=this.already.size;this.status.lastError=null
  }catch(e){
   this.status.openViking='OFFLINE';this.status.lastError=e instanceof Error?e.message:String(e)
  }
  return this.snapshot()
 }
}
