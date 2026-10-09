/**
 * Append-only, local-only history for existing and historical research logs.
 * This code NEVER writes to the original logs, broker, strategy or simulator state.
 * Place historical .zip or .jsonl files in logs/history-inbox; even nested ZIPs work.
 */
import {createHash} from 'node:crypto'
import {appendFileSync,existsSync,mkdirSync,openSync,readFileSync,readSync,readdirSync,renameSync,statSync,writeFileSync,closeSync} from 'node:fs'
import {dirname,join,relative,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {inflateRawSync} from 'node:zlib'

const DEFAULT_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../../')
const LOG_FOLDERS=['simulator','shadow-paper','shadow-candidates','no-macro-early-exit','ollama-paper','ollama-memory','fimathe-market','fimathe-paper']
const MAX_ZIP_BYTES=64*1024*1024
const MAX_UNPACKED_ENTRY=128*1024*1024

type Cursor={offset:number;size:number;mtimeMs:number;head:string}
type EventRecord={id:string;at:string|null;event:string;source:string;strategy:string;origin:'LIVE'|'ARCHIVE';location:string;data:Record<string,unknown>}
type Stats={events:number;closedTrades:number;wins:number;losses:number;netPnlUsd:number;grossProfitUsd:number;grossLossUsd:number;mirrorOpens:number;mirrorOpenErrors:number;mirrorCloseErrors:number}
export type HistorySummary={updatedAt:string;totalEvents:number;filesTracked:number;archivesTracked:number;errors:string[];strategies:Record<string,Stats>;lastEventAt:string|null}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex')
const stats=():Stats=>({events:0,closedTrades:0,wins:0,losses:0,netPnlUsd:0,grossProfitUsd:0,grossLossUsd:0,mirrorOpens:0,mirrorOpenErrors:0,mirrorCloseErrors:0})
function sourceOf(location:string){
 const parts=location.toLowerCase().split(/[\\/]+/)
 // Check all path segments, not the archive name (e.g. shadow-paper-backup.zip).
 return LOG_FOLDERS.find(folder=>parts.includes(folder))||'unclassified'
}
function strategyOf(source:string,event:string){
 if(event.startsWith('SHADOW_DEMO_MIRROR_'))return'OANDA_PRACTICE_SHADOW'
 return ({'simulator':'STRICT_4_OF_4','shadow-paper':'SHADOW_3_OF_4','shadow-candidates':'SHADOW_CANDIDATES','no-macro-early-exit':'NO_MACRO_EARLY_EXIT','ollama-paper':'OLLAMA_PAPER','ollama-memory':'OLLAMA_MEMORY','fimathe-paper':'FIMATHE_PAPER','fimathe-market':'FIMATHE_MARKET'} as Record<string,string>)[source]||'UNCLASSIFIED'
}
const CLOSE_EVENTS=new Set(['PAPER_CLOSE','SHADOW_PAPER_CLOSE','NO_MACRO_EARLY_EXIT_PAPER_CLOSE','OLLAMA_PAPER_CLOSE','FIMATHE_PAPER_CLOSE','SHADOW_DEMO_MIRROR_CLOSED','SHADOW_DEMO_MIRROR_CLOSE_RECONCILED'])
const ACTIVE_STRATEGIES=new Set(['STRICT_4_OF_4','SHADOW_3_OF_4','SHADOW_CANDIDATES','OANDA_PRACTICE_SHADOW','NO_MACRO_EARLY_EXIT','OLLAMA_PAPER','OLLAMA_MEMORY','FIMATHE_PAPER','FIMATHE_MARKET'])
const MAX_ERRORS=30

/** Reads ZIP central directory without extracting files or altering the originals. */
function zipEntries(zip:Buffer,visit:(path:string,content:Buffer)=>void,level=0,prefix=''){
 if(level>3)throw Error('Nested ZIP depth exceeded')
 if(zip.length>MAX_ZIP_BYTES)throw Error('ZIP exceeds safe compressed size limit')
 let eocd=-1
 for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--){if(zip.readUInt32LE(i)===0x06054b50){eocd=i;break}}
 if(eocd<0)throw Error('Invalid ZIP central directory')
 const total=zip.readUInt16LE(eocd+10)
 let cursor=zip.readUInt32LE(eocd+16)
 for(let entry=0;entry<total;entry++){
  if(cursor+46>zip.length||zip.readUInt32LE(cursor)!==0x02014b50)throw Error('Invalid ZIP directory entry')
  const flags=zip.readUInt16LE(cursor+8),method=zip.readUInt16LE(cursor+10)
  const packed=zip.readUInt32LE(cursor+20),unpacked=zip.readUInt32LE(cursor+24)
  const nameLength=zip.readUInt16LE(cursor+28),extra=zip.readUInt16LE(cursor+30),comment=zip.readUInt16LE(cursor+32)
  const local=zip.readUInt32LE(cursor+42)
  const name=zip.toString('utf8',cursor+46,cursor+46+nameLength).replace(/\\/g,'/')
  cursor+=46+nameLength+extra+comment
  if(name.endsWith('/')||!(name.toLowerCase().endsWith('.jsonl')||name.toLowerCase().endsWith('.zip')))continue
  if(flags&1)continue // encrypted: do not attempt to read
  if(unpacked>MAX_UNPACKED_ENTRY||packed>MAX_ZIP_BYTES)throw Error('ZIP member exceeds safe size limit: '+name)
  if(local+30>zip.length||zip.readUInt32LE(local)!==0x04034b50)throw Error('Invalid ZIP member: '+name)
  const offset=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28)
  if(offset+packed>zip.length)throw Error('ZIP member outside archive: '+name)
  const content=method===0?zip.subarray(offset,offset+packed):method===8?inflateRawSync(zip.subarray(offset,offset+packed),{maxOutputLength:MAX_UNPACKED_ENTRY}):null
  if(!content)continue
  if(name.toLowerCase().endsWith('.zip'))zipEntries(content,visit,level+1,prefix+name+'!/')
  else visit(prefix+name,content)
 }
}

export class HistorySync{
 private readonly root:string
 private readonly outDir:string
 private readonly ledger:string
 private readonly shadowLedger:string
 private readonly statePath:string
 private readonly summaryPath:string
 private cursors:Record<string,Cursor>={}
 private zipCursors:Record<string,string>={}
 private ids=new Set<string>()
 private running=false
 private timer:NodeJS.Timeout|null=null
 private lastSummary:HistorySummary={updatedAt:'',totalEvents:0,filesTracked:0,archivesTracked:0,errors:[],strategies:{},lastEventAt:null}
 constructor(root=DEFAULT_ROOT){
  this.root=resolve(root)
  this.outDir=join(this.root,'logs','history')
  this.ledger=join(this.outDir,'events.jsonl')
  this.shadowLedger=join(this.outDir,'shadow-paper-trades.jsonl')
  this.statePath=join(this.outDir,'cursors.json')
  this.summaryPath=join(this.outDir,'summary.json')
  mkdirSync(this.outDir,{recursive:true})
  if(existsSync(this.statePath))try{
   const v=JSON.parse(readFileSync(this.statePath,'utf8'))
   if(v.version===1){this.cursors=v.cursors||{};this.zipCursors=v.archives||{}}
  }catch{/* corrupted cursor must not destroy logs; hash index protects against duplication */}
  // Rebuild the dedup index and summary from committed journal entries, not a fragile counter.
  if(existsSync(this.ledger)){
   for(const line of readFileSync(this.ledger,'utf8').split(/\r?\n/)){
    if(!line)continue
    try{const row=JSON.parse(line) as EventRecord;if(row.id)this.ids.add(row.id)}catch{/* incomplete line after a crash is ignored */}
   }
   // A crash mid-write must not glue the next new JSON row to the truncated row.
   const h=openSync(this.ledger,'r');try{const n=statSync(this.ledger).size;if(n){const b=Buffer.alloc(1);readSync(h,b,0,1,n-1);if(b[0]!==10)appendFileSync(this.ledger,'\n')}}finally{closeSync(h)}
  }
  // Rebuild once at startup, so a crash between journal append and summary write is harmless.
  this.lastSummary=this.rebuildSummary([])
 }
 getSummary(){return this.lastSummary}
 private fileList(dir:string):string[]{
  if(!existsSync(dir))return[]
  const result:string[]=[]
  for(const dirent of readdirSync(dir,{withFileTypes:true})){
   const path=join(dir,dirent.name)
   if(dirent.isDirectory())result.push(...this.fileList(path))
   else if(dirent.isFile()&&(path.toLowerCase().endsWith('.jsonl')||path.toLowerCase().endsWith('.zip')))result.push(path)
  }
  return result.sort()
 }
 private ingest(sourceLocation:string,kind:'LIVE'|'ARCHIVE',lines:Iterable<string>,out:EventRecord[],shadow:Record<string,unknown>[]){
  const source=sourceOf(sourceLocation)
  if(source==='unclassified')return
  for(const line of lines){
   if(!line.trim())continue
   let data:Record<string,unknown>
   try{const raw=JSON.parse(line);if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;data=raw}catch{continue}
   const event=typeof data.event==='string'?data.event:'UNKNOWN'
   const id=sha(source+'\u0000'+JSON.stringify(data))
   if(this.ids.has(id))continue
   const at=typeof data.at==='string'?data.at:typeof data.timestamp==='string'?data.timestamp:null
   out.push({id,at,event,source,strategy:strategyOf(source,event),origin:kind,location:sourceLocation,data})
   this.ids.add(id)
   if(source==='shadow-paper')shadow.push(data)
  }
 }
 private liveFile(path:string,out:EventRecord[],shadow:Record<string,unknown>[]){
  const stat=statSync(path)
  const key=relative(this.root,path)
  const h=openSync(path,'r'),headBuffer=Buffer.alloc(Math.min(256,stat.size))
  try{
   if(headBuffer.length)readSync(h,headBuffer,0,headBuffer.length,0)
   const head=sha(headBuffer.toString('base64'))
   const past=this.cursors[key]
   const offset=past&&past.offset<=stat.size&&past.head===head?past.offset:0
   // Read only new bytes. Keep an incomplete last JSONL row for the next scan.
   let pos=offset,pending=Buffer.alloc(0),processed=offset
   const chunk=Buffer.alloc(256*1024)
   while(pos<stat.size){
    const count=readSync(h,chunk,0,Math.min(chunk.length,stat.size-pos),pos)
    if(!count)break
    pos+=count
    const block=Buffer.concat([pending,chunk.subarray(0,count)])
    let start=0
    for(let i=0;i<block.length;i++)if(block[i]===10){
     this.ingest(key,'LIVE',[block.toString('utf8',start,i)],out,shadow)
     start=i+1
    }
    pending=Buffer.from(block.subarray(start))
    processed=pos-pending.length
   }
   this.cursors[key]={offset:processed,size:stat.size,mtimeMs:stat.mtimeMs,head}
  }finally{closeSync(h)}
 }
 private archiveFile(path:string,out:EventRecord[],shadow:Record<string,unknown>[]){
  const s=statSync(path),key=relative(this.root,path)
  const version=`${s.size}:${s.mtimeMs}`
  if(this.zipCursors[key]===version)return
  zipEntries(readFileSync(path),(member,bytes)=>{
   this.ingest(key+'!/'+member,'ARCHIVE',bytes.toString('utf8').split(/\r?\n/),out,shadow)
  })
  this.zipCursors[key]=version
 }
 sync():HistorySummary{
  if(this.running)return this.lastSummary
  this.running=true
  const errors:string[]=[],incoming:EventRecord[]=[],shadow:Record<string,unknown>[]=[]
  try{
   // Historical imports first, followed by live streams. Each full JSON row is deduplicated.
   const inbox=join(this.root,'logs','history-inbox')
   for(const file of this.fileList(inbox))try{
    if(file.toLowerCase().endsWith('.zip'))this.archiveFile(file,incoming,shadow)
    else this.liveFile(file,incoming,shadow)
   }catch(e){if(errors.length<MAX_ERRORS)errors.push(relative(this.root,file)+': '+String(e))}
   for(const folder of LOG_FOLDERS){
    for(const file of this.fileList(join(this.root,'logs',folder))){
     if(!file.toLowerCase().endsWith('.jsonl'))continue
     try{this.liveFile(file,incoming,shadow)}catch(e){if(errors.length<MAX_ERRORS)errors.push(relative(this.root,file)+': '+String(e))}
    }
   }
   if(incoming.length)appendFileSync(this.ledger,incoming.map(x=>JSON.stringify(x)).join('\n')+'\n','utf8')
   if(shadow.length)appendFileSync(this.shadowLedger,shadow.map(x=>JSON.stringify(x)).join('\n')+'\n','utf8')
   const summary=this.addToSummary(incoming,errors)
   const temp=this.statePath+'.tmp'
   writeFileSync(temp,JSON.stringify({version:1,cursors:this.cursors,archives:this.zipCursors},null,2))
   renameSync(temp,this.statePath)
   writeFileSync(this.summaryPath+'.tmp',JSON.stringify(summary,null,2))
   renameSync(this.summaryPath+'.tmp',this.summaryPath)
   this.lastSummary=summary
   return summary
  }finally{this.running=false}
 }
 private rebuildSummary(errors:string[]):HistorySummary{
  const all:EventRecord[]=[]
  if(existsSync(this.ledger))for(const line of readFileSync(this.ledger,'utf8').split(/\r?\n/)){
   try{if(line){const r=JSON.parse(line);if(r.id&&r.strategy)all.push(r)}}catch{}
  }
  return this.addToSummary(all,errors,true)
 }
 private addToSummary(rows:EventRecord[],errors:string[],reset=false):HistorySummary{
  const strategies:Record<string,Stats>=reset?{}:JSON.parse(JSON.stringify(this.lastSummary.strategies))
  let totalEvents=reset?0:this.lastSummary.totalEvents,lastEventAt=reset?null:this.lastSummary.lastEventAt
  for(const r of rows){
   // Retain original archive entries but exclude retired engines from active summary.
   if(!ACTIVE_STRATEGIES.has(r.strategy))continue
   totalEvents++
   if(r.at&&(!lastEventAt||r.at>lastEventAt))lastEventAt=r.at
   const s=strategies[r.strategy]||(strategies[r.strategy]=stats())
   s.events++
   if(r.event==='SHADOW_DEMO_MIRROR_OPENED')s.mirrorOpens++
   if(r.event==='SHADOW_DEMO_MIRROR_OPEN_ERROR')s.mirrorOpenErrors++
   if(r.event==='SHADOW_DEMO_MIRROR_CLOSE_ERROR')s.mirrorCloseErrors++
   if(!CLOSE_EVENTS.has(r.event))continue
   const pnl=Number(r.data.pnl??r.data.realizedPL)
   if(!Number.isFinite(pnl))continue
   s.closedTrades++
   if(pnl>0){s.wins++;s.grossProfitUsd+=pnl}
   if(pnl<0){s.losses++;s.grossLossUsd+=Math.abs(pnl)}
   s.netPnlUsd+=pnl
  }
  for(const s of Object.values(strategies)){
   s.netPnlUsd=Number(s.netPnlUsd.toFixed(4));s.grossProfitUsd=Number(s.grossProfitUsd.toFixed(4));s.grossLossUsd=Number(s.grossLossUsd.toFixed(4))
  }
  return{updatedAt:new Date().toISOString(),totalEvents,filesTracked:Object.keys(this.cursors).length,archivesTracked:Object.keys(this.zipCursors).length,errors,strategies,lastEventAt}
 }
 start(intervalMs=60000){
  // The first sync completes before simulator begins and before ShadowMemory reads history.
  try{this.sync()}catch(e){console.error('[HistorySync] Initial sync failed:',e)}
  this.timer=setInterval(()=>{try{this.sync()}catch(e){console.error('[HistorySync] Sync failed:',e)}},Math.max(10000,intervalMs))
  this.timer.unref()
 }
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
}
