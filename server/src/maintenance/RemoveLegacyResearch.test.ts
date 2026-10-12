import {describe,it,expect,afterEach} from 'vitest'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {purgeLegacyResearch} from './RemoveLegacyResearch.js'

const dirs:string[]=[]
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'tiago-oanda-cleanup-'))
 dirs.push(root)
 writeFileSync(join(root,'package.json'),JSON.stringify({name:'profitmind-forex'}))
 function put(rel:string,data='data'){
  const p=join(root,rel);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,data)
 }
 return{root,put}
}
afterEach(()=>{for(const p of dirs.splice(0))rmSync(p,{recursive:true,force:true})})
describe('first-run permanent cleanup preserves all OANDA and Shadow facts',()=>{
 it('deletes only retired simulation files, keeps Shadow state/trade logs, broker audit, .env, and mixed Shadow archives',()=>{
  const t=fixture()
  t.put('.env','OANDA_API_TOKEN=secret')
  t.put('data/simulator-state.json',JSON.stringify({shadowExperiment:{position:{brokerMirrorTradeId:'46'}}}))
  t.put('data/shadow-simulator-risk.json','safety')
  t.put('data/ollama-oanda-mirror-state.json','trade 31')
  t.put('data/ollama-signal-state.json','signal')
  t.put('logs/ollama-paper/oanda-mirror.jsonl','OANDA trade 31')
  t.put('logs/shadow-paper/trades.jsonl','OANDA linked 46')
  t.put('logs/shadow-candidates/2026-10-12.jsonl','candidate')
  t.put('logs/history/shadow-paper-trades.jsonl','historical Shadow')
  t.put('logs/history-inbox/mixed-old.zip','mixed archives preserved')
  t.put('logs/history/events.jsonl','mixed history')
  t.put('logs/simulator/trades.jsonl','virtual Strict')
  t.put('logs/fimathe-paper/trades.jsonl','virtual Fimathe')
  t.put('logs/no-macro-early-exit/trades.jsonl','virtual No Macro')
  t.put('data/fimathe-paper-state.json','virtual')
  t.put('data/simulator-risk.json','virtual')
  t.put('data/no-macro-early-exit-risk.json','virtual')
  t.put('logs/ollama-paper/trades.jsonl','virtual Ollama fills')
  t.put('logs/ollama-paper/2026-10-12.jsonl',[
   JSON.stringify({event:'OLLAMA_LAB_PAPER_CLOSE',pnl:'999'}),
   JSON.stringify({event:'OLLAMA_OANDA_SIGNAL',key:'abc'}),
   JSON.stringify({event:'OLLAMA_LAB_DECISION',decision:'WAIT'})
  ].join('\n')+'\n')
  const result=purgeLegacyResearch(t.root)
  expect(result.failed).toEqual([])
  expect(result.pruned).toBe(1)
  expect(result.deleted).toContain('logs/fimathe-paper')
  expect(result.deleted).toContain('logs/simulator')
  expect(result.deleted).toContain('data/no-macro-early-exit-risk.json')
  for(const path of ['.env','data/simulator-state.json','data/shadow-simulator-risk.json',
   'data/ollama-oanda-mirror-state.json','data/ollama-signal-state.json',
   'logs/ollama-paper/oanda-mirror.jsonl','logs/shadow-paper/trades.jsonl',
   'logs/shadow-candidates/2026-10-12.jsonl','logs/history/shadow-paper-trades.jsonl',
   'logs/history-inbox/mixed-old.zip'])expect(existsSync(join(t.root,path))).toBe(true)
  for(const path of ['logs/history/events.jsonl','logs/simulator/trades.jsonl',
   'logs/fimathe-paper/trades.jsonl','logs/no-macro-early-exit/trades.jsonl',
   'data/fimathe-paper-state.json','data/simulator-risk.json','data/no-macro-early-exit-risk.json',
   'logs/ollama-paper/trades.jsonl'])expect(existsSync(join(t.root,path))).toBe(false)
  const kept=readFileSync(join(t.root,'logs/ollama-paper/2026-10-12.jsonl'),'utf8')
  expect(kept).not.toContain('PAPER_CLOSE')
  expect(kept).toContain('OLLAMA_OANDA_SIGNAL')
  expect(purgeLegacyResearch(t.root).alreadyDone).toBe(true)
 })
 it('refuses to delete from an arbitrary folder not recognized as Tiago',()=>{
  const dir=mkdtempSync(join(tmpdir(),'not-tiago-'));dirs.push(dir)
  expect(()=>purgeLegacyResearch(dir)).toThrow('Not a recognized Tiago project')
 })
})
