import {existsSync,readFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {strategyContext} from '../indicators.js'
import type {Candle} from '../indicators.js'
import type {OandaReadOnly} from '../broker/OandaReadOnly.js'

type Broker=Pick<OandaReadOnly,'closedTrades'|'candlesBefore'|'candlesDuring'>
export type MarketFeatures={
 rsi14:number;bbPosition:'BELOW_LOWER'|'ABOVE_UPPER'|'INSIDE';volumeRatio:number;
 macroTrend:'UP'|'DOWN';close:number;macroSma20:number;macroClose:number
}
export type ChartTimeframe='M1'|'M5'|'M10'|'M15'|'H1'
export type JourneyTimeframe=ChartTimeframe|'H4'|'D'|'W'
export type ChartWindow={timeframe:ChartTimeframe;bars:Candle[]}
export type SixChartSet={
 windows:ChartWindow[];journey:{bars:Candle[];granularity:JourneyTimeframe;complete:boolean;note:string};
 entryTime:string;exitTime:string;entryPrice:string|null;exitPrice:string|null;
 stopPrice:string|null;targetPrice:string|null;source:'OANDA_COMPLETED_MID_CANDLES'
}
const minute=60000
const granularityMinutes:Record<JourneyTimeframe,number>={M1:1,M5:5,M10:10,M15:15,H1:60,H4:240,D:1440,W:10080}
export function journeyGranularity(start:string,end:string):JourneyTimeframe{
 const duration=(Date.parse(end)-Date.parse(start))/minute
 if(!Number.isFinite(duration)||duration<=0)throw Error('Invalid historical trade duration')
 for(const tf of ['M1','M5','M10','M15','H1','H4','D','W'] as JourneyTimeframe[]){
  if(duration/granularityMinutes[tf]<=180)return tf
 }
 throw Error('Trade duration exceeds full-chart resolution')
}
export function chartCoverage(charts:SixChartSet|null|undefined){
 return charts?charts.windows.filter(w=>w.bars.length>=2).length+
  (charts.journey.bars.length>=2&&charts.journey.complete?1:0):0
}
export type VerifiedLesson={
 tradeId:string;symbol:string;direction:'LONG'|'SHORT';openedAt:string;closedAt:string;
 realizedPL:number;outcome:'WIN'|'LOSS'|'FLAT';features:MarketFeatures|null;
 charts?:SixChartSet
}
type Status='WAITING'|'READY'|'UNAVAILABLE'
type Options={mirrorLogFile?:string;now?:()=>Date;refreshMs?:number}
const here=dirname(fileURLToPath(import.meta.url))
const root=resolve(here,'../../../')
const validId=(x:unknown)=>typeof x==='string'&&/^\d+$/.test(x)
export function verifiedMirrorIds(source:string){
 const ids=new Set<string>()
 for(const line of source.split(/\r?\n/)){
  if(!line.trim())continue
  let e:any
  try{e=JSON.parse(line)}catch{continue}
  if(e.event==='SHADOW_DEMO_MIRROR_OPENED'&&validId(String(e.tradeId??'')))ids.add(String(e.tradeId))
  if(e.event==='SHADOW_PAPER_CLOSE'&&validId(String(e.demoMirrorTradeId??'')))ids.add(String(e.demoMirrorTradeId))
  if(e.event==='SHADOW_DEMO_MIRROR_CLOSED'&&validId(String(e.tradeId??'')))ids.add(String(e.tradeId))
 }
 return ids
}
export function featuresFromCandles(m5:Candle[],m10:Candle[]):MarketFeatures{
 const c=strategyContext(m5,m10)
 return{
  rsi14:Number(c.rsi14.toFixed(1)),
  bbPosition:c.close<c.bbLower?'BELOW_LOWER':c.close>c.bbUpper?'ABOVE_UPPER':'INSIDE',
  volumeRatio:Number((c.vma20>0?c.volume/c.vma20:0).toFixed(2)),
  macroTrend:c.macroClose>=c.macroSma20?'UP':'DOWN',
  close:c.close,macroSma20:c.macroSma20,macroClose:c.macroClose
 }
}
export function summarizeBrokerLessons(lessons:VerifiedLesson[]){
 const summary={trades:lessons.length,wins:0,losses:0,netPL:0,avgWin:0,avgLoss:0,featureSamples:0,
  observedWinningConditions:[] as Array<{condition:string;wins:number;losses:number}>}
 const buckets=new Map<string,{wins:number;losses:number}>()
 let winPL=0,lossPL=0
 for(const t of lessons){
  summary.netPL+=t.realizedPL
  if(t.realizedPL>0){summary.wins++;winPL+=t.realizedPL}
  else if(t.realizedPL<0){summary.losses++;lossPL+=t.realizedPL}
  if(!t.features)continue
  summary.featureSamples++
  const tags=[t.symbol,t.direction,t.features.macroTrend,t.features.bbPosition,
   t.features.rsi14<30?'RSI_BELOW_30':t.features.rsi14>70?'RSI_ABOVE_70':'RSI_MIDDLE',
   t.features.volumeRatio>=1.5?'HIGH_VOLUME':'NORMAL_VOLUME']
  for(const tag of tags){
   const b=buckets.get(tag)||{wins:0,losses:0}
   if(t.realizedPL>0)b.wins++
   if(t.realizedPL<0)b.losses++
   buckets.set(tag,b)
  }
 }
 summary.netPL=Number(summary.netPL.toFixed(2))
 summary.avgWin=summary.wins?Number((winPL/summary.wins).toFixed(2)):0
 summary.avgLoss=summary.losses?Number((lossPL/summary.losses).toFixed(2)):0
 // Descriptive only: never claim profitability with too few examples.
 summary.observedWinningConditions=[...buckets.entries()]
  .filter(([,v])=>v.wins+v.losses>=3&&v.wins>v.losses)
  .map(([condition,v])=>({condition,...v}))
  .sort((a,b)=>b.wins-a.wins).slice(0,5)
 return summary
}
export class OandaOutcomeResearch{
 private readonly logPath:string
 private readonly now:()=>Date
 private readonly refreshMs:number
 private lastAttempt=0
 private lessons:VerifiedLesson[]=[]
 private contextCache=new Map<string,MarketFeatures|null>()
 private chartCache=new Map<string,SixChartSet>()
 private status:Status='WAITING'
 private lastSync:string|null=null
 private error:string|null=null
 private closedTradesSeen=0
 private linkedIds=0
 private missingAttribution=0
 private historyCap=100
 constructor(private broker:Broker,opts:Options={}){
  this.logPath=opts.mirrorLogFile||resolve(root,'logs/shadow-paper/trades.jsonl')
  this.now=opts.now||(()=>new Date())
  this.refreshMs=opts.refreshMs??15*60*1000
 }
 snapshot(){return{
  source:'OANDA_CLOSED_TRADES' as const,attribution:'CONFIRMED_SHADOW_MIRROR_IDS_ONLY' as const,
  status:this.status,lastSync:this.lastSync,error:this.error,
  reviewedBrokerClosedTrades:this.closedTradesSeen,recognizedMirrorIds:this.linkedIds,
  unattributedBrokerTrades:this.missingAttribution,historyCap:this.historyCap,
  summary:summarizeBrokerLessons(this.lessons),
  examples:this.lessons.slice(-8).reverse(),
  chartCoverage:this.lessons.filter(t=>chartCoverage(t.charts)===6).length,
  chartPartial:this.lessons.filter(t=>chartCoverage(t.charts)>0&&chartCoverage(t.charts)<6).length
 }}
 lessonsFor(symbol:string){return this.lessons.filter(x=>x.symbol===symbol&&x.features).slice(-6).map(x=>({
  outcome:x.outcome,realizedPL:x.realizedPL,direction:x.direction,features:x.features,
  chartEvidence:x.charts?{
   // Model sees OBSERVED OHLC midpoint sequences, not screenshots or the final trade price.
   entryWindows:x.charts.windows.filter(w=>w.bars.length>=2).map(w=>({
    timeframe:w.timeframe,closes:w.bars.slice(-12).map(c=>Number(c.close.toFixed(6)))
   })),
   intratrade:x.charts.journey.bars.length>=2?{
    timeframe:x.charts.journey.granularity,
    closes:x.charts.journey.bars.filter((_,i)=>i%Math.max(1,Math.ceil(x.charts!.journey.bars.length/12))===0)
     .slice(-12).map(c=>Number(c.close.toFixed(6))),
    complete:x.charts.journey.complete
   }:null,
   entryTime:x.charts.entryTime,exitTime:x.charts.exitTime
  }:null,
  note:'Actual OANDA closed trade, confirmed Shadow mirror ID. Observational sample, not a forecast.'
 }))}
 completedSince(start:string){
  const t=Date.parse(start)
  return this.lessons.filter(l=>Number.isFinite(t)&&Date.parse(l.closedAt)>=t)
 }
 async refresh(){
  const ms=this.now().getTime()
  if(this.lastAttempt&&ms-this.lastAttempt<this.refreshMs)return this.snapshot()
  this.lastAttempt=ms
  try{
   const raw=await this.broker.closedTrades(this.historyCap)
   const ids=existsSync(this.logPath)?verifiedMirrorIds(readFileSync(this.logPath,'utf8')):new Set<string>()
   const usable=raw.filter(t=>t.state==='CLOSED'&&Number.isFinite(Number(t.realizedPL))&&
    /^\w{3}_USD$/.test(t.instrument)&&Number.isFinite(Date.parse(t.openTime))&&Number.isFinite(Date.parse(t.closeTime)))
   const matched=usable.filter(t=>ids.has(String(t.id))).sort((a,b)=>Date.parse(a.closeTime)-Date.parse(b.closeTime))
   // Research only. Never changes broker orders or Shadow's strategy.
   // A maximum of one newly attributed trade gets expensive chart history per refresh.
   // Older trades remain eligible on subsequent refreshes; avoid unbounded OANDA traffic.
   const chartTarget=[...matched].reverse().find(t=>!this.chartCache.has(String(t.id)))
   if(chartTarget){
    const t=chartTarget
    const timeframes=['M1','M5','M10','M15','H1'] as ChartTimeframe[]
    const wanted=journeyGranularity(t.openTime,t.closeTime)
    const requests=await Promise.allSettled([
     ...timeframes.map(tf=>this.broker.candlesBefore(t.instrument,tf,t.openTime,50)),
     this.broker.candlesDuring(t.instrument,wanted,t.openTime,t.closeTime)
    ])
    const windows=timeframes.map((tf,i)=>({timeframe:tf,bars:requests[i].status==='fulfilled'
      ?(requests[i] as PromiseFulfilledResult<Candle[]>).value.slice(-50):[]}))
    const full=requests[5].status==='fulfilled'?(requests[5] as PromiseFulfilledResult<Candle[]>).value:[]
    const journeyComplete=requests[5].status==='fulfilled'&&full.length>=2
    const validPrice=(p:unknown)=>typeof p==='string'&&Number.isFinite(Number(p))&&Number(p)>0?p:null
    const chart:SixChartSet={
     source:'OANDA_COMPLETED_MID_CANDLES',
     entryTime:t.openTime,exitTime:t.closeTime,
     entryPrice:validPrice(t.price),exitPrice:validPrice(t.averageClosePrice),
     stopPrice:validPrice(t.stopLossOrder?.price),targetPrice:validPrice(t.takeProfitOrder?.price),
     windows,journey:{bars:full,granularity:wanted,complete:journeyComplete,
      note:journeyComplete?'Completed historical OANDA midpoint candles throughout broker trade; no interpolation.':
        'Full intratrade path unavailable or too sparse at selected granularity; no missing candles fabricated.'}
    }
    // Retain complete/partial coverage. Incomplete windows are clearly marked unavailable in UI.
    this.chartCache.set(String(t.id),chart)
   }
   const lessons:VerifiedLesson[]=[]
   // Bound broker requests to keep the local research assistant responsive.
   const contextIds=new Set(matched.filter(t=>!this.contextCache.has(String(t.id))).slice(-4).map(t=>String(t.id)))
   for(const t of matched){
    let features=this.contextCache.get(String(t.id))??null
    if(contextIds.has(String(t.id))&&!this.contextCache.has(String(t.id))){
     try{
      const [m5,m10]=await Promise.all([
       this.broker.candlesBefore(t.instrument,'M5',t.openTime,35),
       this.broker.candlesBefore(t.instrument,'M10',t.openTime,25)
      ])
      features=featuresFromCandles(m5,m10)
      this.contextCache.set(String(t.id),features)

     }catch{this.contextCache.set(String(t.id),null)}
    }
    const pl=Number(t.realizedPL)
    lessons.push({tradeId:String(t.id),symbol:t.instrument,direction:Number(t.initialUnits)<0?'SHORT':'LONG',
     openedAt:t.openTime,closedAt:t.closeTime,realizedPL:pl,outcome:pl>0?'WIN':pl<0?'LOSS':'FLAT',features,charts:this.chartCache.get(String(t.id))})
   }
   this.lessons=lessons
   this.status='READY';this.error=null;this.lastSync=this.now().toISOString()
   this.closedTradesSeen=raw.length;this.linkedIds=ids.size
   this.missingAttribution=raw.length-matched.length
  }catch(e){
   this.status='UNAVAILABLE';this.error=e instanceof Error?e.message:String(e)
   // Previous observations remain available but are explicitly marked stale/unavailable.
  }
  return this.snapshot()
 }
}
