import{appendFileSync,mkdirSync}from'node:fs'
import{resolve}from'node:path'

function day(ts=new Date()){return ts.toISOString().slice(0,10)}

export function logSimulator(event:Record<string,unknown>){
 const dir=resolve(process.cwd(),'..','logs','simulator')
 mkdirSync(dir,{recursive:true})
 const row={at:new Date().toISOString(),...event}
 appendFileSync(resolve(dir,`${day()}.jsonl`),JSON.stringify(row)+'\n','utf8')
}

export function logTrade(event:Record<string,unknown>){
 const dir=resolve(process.cwd(),'..','logs','simulator')
 mkdirSync(dir,{recursive:true})
 const row={at:new Date().toISOString(),...event}
 appendFileSync(resolve(dir,'trades.jsonl'),JSON.stringify(row)+'\n','utf8')
}


export function logFimatheMarket(event:Record<string,unknown>){
 const dir=resolve(process.cwd(),'..','logs','fimathe-market')
 mkdirSync(dir,{recursive:true})
 const row={at:new Date().toISOString(),...event}
 appendFileSync(resolve(dir,`${day()}.jsonl`),JSON.stringify(row)+'\n','utf8')
}


export function logShadowCandidate(event:Record<string,unknown>){
 const dir=resolve(process.cwd(),'..','logs','shadow-candidates')
 mkdirSync(dir,{recursive:true})
 const row={at:new Date().toISOString(),...event}
 appendFileSync(resolve(dir,`${day()}.jsonl`),JSON.stringify(row)+'\n','utf8')
}


export function logShadowTrade(event:Record<string,unknown>){
 const dir=resolve(process.cwd(),'..','logs','shadow-paper')
 mkdirSync(dir,{recursive:true})
 const row={at:new Date().toISOString(),...event}
 appendFileSync(resolve(dir,'trades.jsonl'),JSON.stringify(row)+'\n','utf8')
}
