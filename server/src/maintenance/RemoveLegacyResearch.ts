import {existsSync,lstatSync,readFileSync,readdirSync,rmSync,mkdirSync,renameSync,writeFileSync,appendFileSync} from 'node:fs'
import {resolve,dirname,join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'

const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../../')
const VERSION='broker-only-cleanup-v1'
const retired=[
 'data/simulator-risk.json',
 'data/no-macro-early-exit-risk.json',
 'data/fimathe-paper-state.json',
 'data/fimathe-paper-risk.json',
 'data/ollama-shadow-memory-state.json',
 'logs/simulator',
 'logs/simulator-runner.log',
 'logs/no-macro-early-exit',
 'logs/fimathe-market',
 'logs/fimathe-paper',
 'logs/ollama-memory',
 'logs/history/events.jsonl',
 'logs/history/summary.json',
 'logs/history/cursors.json',
 'logs/ollama-paper/trades.jsonl'
]
// KEEP: .env, data/simulator-state.json (Shadow broker position recovery),
// data/shadow-simulator-risk.json, data/ollama-oanda-mirror-state.json,
// data/ollama-signal-state.json, logs/shadow-*, logs/history/shadow-paper-trades.jsonl,
// logs/history-inbox (may include original Shadow archives), logs/ollama-paper/oanda-mirror.jsonl.
function safePath(root:string,rel:string){
 if(rel.startsWith('/')||rel.includes('..')||rel.includes('\\'))throw Error('Untrusted cleanup path')
 const full=resolve(root,rel)
 if(!full.startsWith(root+'/')&&!full.startsWith(root+'\\'))throw Error('Cleanup escaped project root')
 const parts=relative(root,full).split(/[\\/]+/)
 let segment=root
 for(const part of parts){
  segment=join(segment,part)
  if(!existsSync(segment))continue
  if(lstatSync(segment).isSymbolicLink())throw Error('Refusing to follow symlink in cleanup: '+rel)
 }
 return full
}
function pruneHistoricalAiEvents(root:string){
 const dir=safePath(root,'logs/ollama-paper')
 if(!existsSync(dir))return 0
 let removed=0
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name)||!entry.isFile()||entry.isSymbolicLink())continue
  const file=safePath(root,'logs/ollama-paper/'+entry.name)
  const old=readFileSync(file,'utf8')
  const retained=old.split(/\r?\n/).filter(line=>{
   if(!line.trim())return false
   let record:any
   try{record=JSON.parse(line)}catch{return true}
   const event=String(record.event??'')
   const isVirtual=/(?:^OLLAMA_LAB_(?:PAPER_OPEN|PAPER_CLOSE|BREAK_EVEN|WAIT_WATCH|WAIT_REVIEW)$)|(?:^OLLAMA_PAPER_)/.test(event)
   if(isVirtual)removed++
   return !isVirtual
  })
  if(retained.join('\n')+'\n'!==old){
   const tmp=file+'.broker-only-tmp'
   writeFileSync(tmp,retained.length?retained.join('\n')+'\n':'','utf8')
   renameSync(tmp,file)
  }
 }
 return removed
}
export function purgeLegacyResearch(root=defaultRoot){
 const base=resolve(root),manifest=resolve(base,'package.json')
 if(!existsSync(manifest)||JSON.parse(readFileSync(manifest,'utf8')).name!=='profitmind-forex')
  throw Error('Not a recognized Tiago project; refusing file deletion')
 const marker=safePath(base,'data/'+VERSION+'.json')
 if(existsSync(marker))return{alreadyDone:true,deleted:[] as string[],pruned:0,failed:[] as string[]}
 const deleted:string[]=[],failed:string[]=[]
 let pruned=0
 try{pruned=pruneHistoricalAiEvents(base)}catch(e){failed.push('AI historical filter: '+String(e))}
 for(const rel of retired){
  try{
   const file=safePath(base,rel)
   if(!existsSync(file))continue
   rmSync(file,{recursive:true,force:false,maxRetries:2,retryDelay:300})
   deleted.push(rel)
  }catch(e){failed.push(rel+': '+String(e))}
 }
 mkdirSync(resolve(base,'logs/maintenance'),{recursive:true})
 appendFileSync(resolve(base,'logs/maintenance/cleanup.jsonl'),
  JSON.stringify({at:new Date().toISOString(),version:VERSION,deleted,prunedVirtualEvents:pruned,failed})+'\n')
 if(!failed.length){
  mkdirSync(dirname(marker),{recursive:true})
  const tmp=marker+'.tmp'
  writeFileSync(tmp,JSON.stringify({at:new Date().toISOString(),version:VERSION,deleted,prunedVirtualEvents:pruned},null,2))
  renameSync(tmp,marker)
 }
 return{alreadyDone:false,deleted,pruned,failed}
}
