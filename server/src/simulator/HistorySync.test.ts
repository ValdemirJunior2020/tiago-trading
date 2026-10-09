import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {HistorySync} from './HistorySync.js'
const dirs:string[]=[]
const setup=()=>{const d=mkdtempSync(join(tmpdir(),'tiago-history-'));dirs.push(d);return d}
const put=(root:string,relativePath:string,content:string|Buffer)=>{
 const file=join(root,relativePath);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,content);return file
}
const row=(at:string,event:string,pnl?:string)=>JSON.stringify({at,event,symbol:'GBP_USD',direction:'long',entry:'1.3',exit:'1.31',units:'25000',...(pnl!==undefined?{pnl}:{})})
// Valid stored-method ZIP fixture, no external dependencies.
function zip(name:string,content:Buffer){
 const filename=Buffer.from(name,'utf8'),header=Buffer.alloc(30),directory=Buffer.alloc(46),end=Buffer.alloc(22)
 header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt32LE(content.length,18);header.writeUInt32LE(content.length,22);header.writeUInt16LE(filename.length,26)
 directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt32LE(content.length,20);directory.writeUInt32LE(content.length,24);directory.writeUInt16LE(filename.length,28)
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(directory.length+filename.length,12);end.writeUInt32LE(header.length+filename.length+content.length,16)
 return Buffer.concat([header,filename,content,directory,filename,end])
}
afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})))
describe('HistorySync append-only consolidation',()=>{
 it('merges older and newer events once, separates paper and OANDA realized P/L, never changes originals',()=>{
  const root=setup(),old=row('2026-10-06T12:00:00Z','SHADOW_PAPER_CLOSE','112.79')
  const live=put(root,'logs/shadow-paper/trades.jsonl',old+'\n')
  const oldZip=zip('backup/shadow-paper/trades.jsonl',Buffer.from(old+'\n'+row('2026-10-05T12:00:00Z','SHADOW_PAPER_CLOSE','22.68')+'\n'))
  put(root,'logs/history-inbox/old.zip',oldZip)
  const sync=new HistorySync(root),first=sync.sync()
  expect(first.strategies.SHADOW_3_OF_4.closedTrades).toBe(2)
  expect(first.strategies.SHADOW_3_OF_4.netPnlUsd).toBe(135.47)
  expect(first.archivesTracked).toBe(1)
  expect(readFileSync(live,'utf8')).toBe(old+'\n')
  expect(sync.sync().totalEvents).toBe(2)
  appendFileSync(live,row('2026-10-09T11:00:00Z','SHADOW_DEMO_MIRROR_CLOSED') .replace('"units":"25000"','"realizedPL":"-43.34","units":"25000"')+'\n')
  const next=sync.sync()
  expect(next.strategies.OANDA_PRACTICE_SHADOW.netPnlUsd).toBe(-43.34)
  expect(next.strategies.SHADOW_3_OF_4.netPnlUsd).toBe(135.47)
  expect(new HistorySync(root).sync().totalEvents).toBe(3)
  const shadowRows=readFileSync(join(root,'logs/history/shadow-paper-trades.jsonl'),'utf8').trim().split('\n')
  expect(shadowRows).toHaveLength(3)
 })
 it('recursively imports nested historical ZIP, then follows incomplete live JSONL without losing data',()=>{
  const root=setup()
  const old=row('2026-10-01T00:00:00Z','NO_MACRO_PAPER_CLOSE','-10')
  put(root,'logs/history-inbox/archive.zip',zip('other/old.zip',zip('no-macro-paper/trades.jsonl',Buffer.from(old+'\n'))))
  const live=put(root,'logs/no-macro-paper/trades.jsonl',row('2026-10-09T00:00:00Z','NO_MACRO_PAPER_CLOSE','30'))
  const sync=new HistorySync(root)
  expect(sync.sync().strategies.NO_MACRO_3_OF_3.closedTrades).toBe(1)
  appendFileSync(live,'\n')
  expect(sync.sync().strategies.NO_MACRO_3_OF_3.netPnlUsd).toBe(20)
  expect(sync.sync().totalEvents).toBe(2)
 })
})
