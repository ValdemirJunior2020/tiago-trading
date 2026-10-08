import {Decimal} from 'decimal.js'
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import type {Direction,BrokerQuote} from '../types.js'
import {LIMITS} from '../config.js'
import {RiskManager} from '../risk/RiskManager.js'
import {OandaReadOnly} from '../broker/OandaReadOnly.js'
import {logFimathePaper} from './logger.js'

/* EXPERIMENTAL PROXY, NOT the exact Fimathe channel-construction method.
   Course material supports macro context, channels, M1 breaks and structural
   stops but does not uniquely specify mathematical channel anchors.
   Rolling 20 completed M1 bars is an explicit research assumption. */
export const FIMATHE_VERSION='fimathe-proxy-v1'
export type Candle={time:string;open:number;high:number;low:number;close:number;volume:number}
export type Decision={side:'LONG'|'SHORT'|'WAIT';reason:string;high:number|null;low:number|null;dailyBias:'UP'|'DOWN'|'FLAT'|'UNKNOWN';time:string|null}
export function evaluateFimatheProxy(m1:Candle[],daily:Candle[]):Decision{
 const last=m1.at(-1),day=daily.at(-1)
 const dailyBias=day?(day.close>day.open?'UP':day.close<day.open?'DOWN':'FLAT'):'UNKNOWN'
 const wait=(reason:string,high:number|null=null,low:number|null=null):Decision=>({side:'WAIT',reason,high,low,dailyBias,time:last?.time??null})
 if(m1.length<22||!last||!day)return wait('INSUFFICIENT_CLOSED_DATA')
 const prior=m1.slice(-21,-1),prev=m1.at(-2)!
 const valid=[day.open,day.close,last.close,prev.close,...prior.flatMap(c=>[c.high,c.low])].every(Number.isFinite)
 if(!valid)return wait('INVALID_DATA')
 const high=Math.max(...prior.map(c=>c.high)),low=Math.min(...prior.map(c=>c.low))
 if(!(high>low))return wait('INVALID_CHANNEL',high,low)
 if(dailyBias==='UP'&&prev.close<=high&&last.close>high)return{side:'LONG',reason:'DAILY_UP_M1_BREAK',high,low,dailyBias,time:last.time}
 if(dailyBias==='DOWN'&&prev.close>=low&&last.close<low)return{side:'SHORT',reason:'DAILY_DOWN_M1_BREAK',high,low,dailyBias,time:last.time}
 return wait('NO_CONFIRMED_BREAK',high,low)
}
type Position={symbol:string;direction:Direction;entry:string;units:string;stop:string;target:string;initialRisk:string;openedAt:string;breakEven:boolean}
type Stats={trades:number;wins:number;losses:number;grossProfit:string;grossLoss:string;netProfit:string;peakNetProfit:string;maxDrawdown:string;lastPnl:string;lastClosedAt:string|null}
type State={version:string;startedAt:string;startingBalance:string;balance:string;realizedPL:string;openPnl:string;equity:string;position:Position|null;lastCandle:Record<string,string>;decisions:number;signals:number;opens:number;closes:number;wins:number;losses:number;lastSignal:Decision|null;lastAction:Record<string,unknown>|null;stats:Stats;paused:boolean}
const base=resolve(dirname(fileURLToPath(import.meta.url)),'../../../data')
const stateFile=resolve(base,'fimathe-paper-state.json')
const riskFile=resolve(base,'fimathe-paper-risk.json')
const startingBalance='1000'
function fresh():State{return{version:FIMATHE_VERSION,startedAt:new Date().toISOString(),startingBalance,balance:startingBalance,realizedPL:'0',openPnl:'0',equity:startingBalance,position:null,lastCandle:{},decisions:0,signals:0,opens:0,closes:0,wins:0,losses:0,lastSignal:null,lastAction:null,paused:false,stats:{trades:0,wins:0,losses:0,grossProfit:'0',grossLoss:'0',netProfit:'0',peakNetProfit:'0',maxDrawdown:'0',lastPnl:'0',lastClosedAt:null}}}
export class FimathePaperEngine{
 private state:State=fresh()
 private risk=new RiskManager(riskFile)
 constructor(private broker:OandaReadOnly){
  if(existsSync(stateFile)){
   try{
    const raw=JSON.parse(readFileSync(stateFile,'utf8')) as State
    if(raw.version!==FIMATHE_VERSION||!raw.stats||!raw.lastCandle||!raw.balance)throw new Error('Incompatible persisted experiment')
    this.state={...this.state,...raw}
   }catch(e){
    this.state.paused=true
    logFimathePaper({event:'FIMATHE_PAPER_STATE_ERROR',error:String(e),note:'Existing state preserved; experiment paused'})
   }
  }else this.risk.recordEquity(startingBalance)
 }
 start(){logFimathePaper({event:'FIMATHE_PAPER_READY',version:FIMATHE_VERSION,startingBalance:this.state.startingBalance,paused:this.state.paused,mode:'PAPER_ONLY',sourceFidelity:'EXPERIMENTAL_NOT_OFFICIAL_FIMATHE'})}
 snapshot(){return this.state}
 private save(){
  if(this.state.paused)return
  mkdirSync(dirname(stateFile),{recursive:true})
  const tmp=stateFile+'.tmp'
  writeFileSync(tmp,JSON.stringify(this.state,null,2),'utf8')
  renameSync(tmp,stateFile)
 }
 private pnl(p:Position,exit:string){
  const diff=p.direction==='long'?new Decimal(exit).minus(p.entry):new Decimal(p.entry).minus(exit)
  return diff.mul(p.units)
 }
 private close(exit:string,reason:string){
  const p=this.state.position
  if(!p)return
  const pnl=this.pnl(p,exit),s=this.state.stats
  this.state.balance=new Decimal(this.state.balance).plus(pnl).toString()
  this.state.realizedPL=new Decimal(this.state.realizedPL).plus(pnl).toString()
  this.state.equity=this.state.balance;this.state.openPnl='0';this.state.position=null;this.state.closes++
  s.trades++
  if(pnl.gt(0)){s.wins++;this.state.wins++;s.grossProfit=new Decimal(s.grossProfit).plus(pnl).toString()}
  else if(pnl.lt(0)){s.losses++;this.state.losses++;s.grossLoss=new Decimal(s.grossLoss).plus(pnl.abs()).toString()}
  s.netProfit=this.state.realizedPL
  s.peakNetProfit=Decimal.max(s.peakNetProfit,s.netProfit).toString()
  s.maxDrawdown=Decimal.max(s.maxDrawdown,new Decimal(s.peakNetProfit).minus(s.netProfit)).toString()
  s.lastPnl=pnl.toString();s.lastClosedAt=new Date().toISOString()
  this.state.lastAction={type:'FIMATHE_PAPER_CLOSE',symbol:p.symbol,reason,pnl:pnl.toString(),at:s.lastClosedAt}
  this.risk.recordEquity(this.state.balance);this.save()
  logFimathePaper({event:'FIMATHE_PAPER_CLOSE',version:FIMATHE_VERSION,symbol:p.symbol,direction:p.direction,entry:p.entry,exit,units:p.units,pnl:pnl.toString(),reason,balance:this.state.balance,openedAt:p.openedAt},true)
 }
 private manage(symbol:string,q:BrokerQuote){
  const p=this.state.position
  if(!p||p.symbol!==symbol)return false
  const exit=p.direction==='long'?q.bid:q.ask,pnl=this.pnl(p,exit)
  this.state.openPnl=pnl.toString();this.state.equity=new Decimal(this.state.balance).plus(pnl).toString()
  if(!p.breakEven&&pnl.gte(p.initialRisk)){p.stop=p.entry;p.breakEven=true;logFimathePaper({event:'FIMATHE_PAPER_BREAK_EVEN',symbol,stop:p.stop})}
  this.risk.recordEquity(this.state.equity)
  const stopped=p.direction==='long'?new Decimal(exit).lte(p.stop):new Decimal(exit).gte(p.stop)
  const target=p.direction==='long'?new Decimal(exit).gte(p.target):new Decimal(exit).lte(p.target)
  if(stopped||target){this.close(exit,stopped?'STRUCTURAL_STOP_OR_BREAKEVEN':'EXPERIMENTAL_2R_TARGET');return true}
  return false
 }
 async process(symbol:string){
  if(this.state.paused||!['EUR_USD','GBP_USD'].includes(symbol))return
  try{
   const q=await this.broker.quote(symbol),qt=Date.parse(q.timestamp)
   if(!Number.isFinite(qt)||Math.abs(Date.now()-qt)>120000||new Decimal(q.bid).lte(0)||new Decimal(q.ask).lte(q.bid)){
    logFimathePaper({event:'FIMATHE_PAPER_SKIP',symbol,reason:'STALE_OR_INVALID_QUOTE'});return
   }
   if(this.manage(symbol,q)){this.save();return}
   const [m1,d]=await Promise.all([this.broker.candles(symbol,'M1',25),this.broker.candles(symbol,'D',3)])
   const candle=m1.at(-1)
   if(!candle||this.state.lastCandle[symbol]===candle.time)return
   this.state.lastCandle[symbol]=candle.time
   const signal=evaluateFimatheProxy(m1,d)
   this.state.decisions++
   logFimathePaper({event:'FIMATHE_PAPER_DECISION',symbol,version:FIMATHE_VERSION,signal,simulatedOnly:true})
   if(signal.side==='WAIT'){this.save();return}
   this.state.signals++;this.state.lastSignal=signal
   if(this.state.position){
    const p=this.state.position
    const opposite=p.symbol===symbol&&((p.direction==='long'&&signal.side==='SHORT')||(p.direction==='short'&&signal.side==='LONG'))
    if(opposite)this.close(p.direction==='long'?q.bid:q.ask,'OPPOSITE_EXPERIMENTAL_SIGNAL')
    else{this.save();return}
   }
   if(this.risk.locked()){logFimathePaper({event:'FIMATHE_PAPER_SKIP',symbol,reason:'24H_DRAWDOWN_KILL'});this.save();return}
   const direction:Direction=signal.side==='LONG'?'long':'short',entry=new Decimal(direction==='long'?q.ask:q.bid)
   const buffer=entry.mul('0.00003')
   const stop=direction==='long'?new Decimal(signal.low!).minus(buffer):new Decimal(signal.high!).plus(buffer)
   const distance=entry.minus(stop).abs()
   if((direction==='long'&&stop.gte(entry))||(direction==='short'&&stop.lte(entry))||distance.gt(entry.mul(LIMITS.hardStop))||distance.lte(0)){
    logFimathePaper({event:'FIMATHE_PAPER_SKIP',symbol,reason:'INVALID_OR_TOO_WIDE_STRUCTURAL_STOP',stop:stop.toString()});this.save();return
   }
   const equity=new Decimal(this.state.equity),budget=equity.mul(LIMITS.riskPerTrade)
   const units=Decimal.min(budget.div(distance).floor(),equity.mul(10).div(entry).floor())
   if(units.lt(1)){logFimathePaper({event:'FIMATHE_PAPER_SKIP',symbol,reason:'INSUFFICIENT_UNITS'});this.save();return}
   const target=direction==='long'?entry.plus(distance.mul(2)):entry.minus(distance.mul(2))
   const at=new Date().toISOString()
   this.state.position={symbol,direction,entry:entry.toString(),units:units.toString(),stop:stop.toString(),target:target.toString(),initialRisk:units.mul(distance).toString(),openedAt:at,breakEven:false}
   this.state.opens++
   this.state.lastAction={type:'FIMATHE_PAPER_OPEN',symbol,direction,entry:entry.toString(),stop:stop.toString(),target:target.toString(),at}
   this.save()
   logFimathePaper({event:'FIMATHE_PAPER_OPEN',version:FIMATHE_VERSION,sourceFidelity:'EXPERIMENTAL_NOT_OFFICIAL_FIMATHE',symbol,direction,entry:entry.toString(),stop:stop.toString(),target:target.toString(),units:units.toString(),riskCash:units.mul(distance).toString(),signal,simulatedOnly:true},true)
  }catch(e){logFimathePaper({event:'FIMATHE_PAPER_ERROR',symbol,error:e instanceof Error?e.message:String(e),version:FIMATHE_VERSION})}
 }
}
