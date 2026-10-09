import type {Candle} from '../indicators.js'
import {strategyContext,sma} from '../indicators.js'

export type RsiZone='OVERSOLD'|'NEUTRAL'|'OVERBOUGHT'
export type SetupDirection='BUY'|'SELL'|'NONE'
export type SetupReview={
 source:'COMPLETED_OANDA_CANDLES';direction:SetupDirection;kind:'TREND_CONTINUATION'|'REVERSAL'|'NO_QUALIFIED_SETUP';
 score:number;maxScore:5;qualified:boolean;rsi14:number;rsiZone:RsiZone;
 spreadPips:number;checks:string[];missing:string[];details:string
}
export function classifyRsi(rsi:number):RsiZone{
 if(!Number.isFinite(rsi))throw new Error('RSI unavailable')
 return rsi<30?'OVERSOLD':rsi>70?'OVERBOUGHT':'NEUTRAL'
}
const round=(x:number)=>Number(x.toFixed(2))
export function scanOllamaSetups(m5:Candle[],m10:Candle[],spreadPips:number):SetupReview{
 const c=strategyContext(m5,m10)
 if(!Number.isFinite(spreadPips)||spreadPips<0)throw new Error('Invalid spread')
 const recent=m5.slice(-3),last=recent.at(-1)!
 const middle=sma(m5.map(x=>x.close),20)
 const volumeRatio=c.vma20>0?c.volume/c.vma20:0
 const trendUp=c.macroClose>c.macroSma20,trendDown=c.macroClose<c.macroSma20
 const advancing=last.close>recent[0].close,falling=last.close<recent[0].close
 const buy=[
  ['M10 uptrend',trendUp],['M5 above SMA20',last.close>middle],
  ['RSI 45-68',c.rsi14>=45&&c.rsi14<=68],['3-candle advance',advancing],
  ['volume >= 0.9x MA20',volumeRatio>=0.9]
 ] as const
 const sell=[
  ['M10 downtrend',trendDown],['M5 below SMA20',last.close<middle],
  ['RSI 32-55',c.rsi14>=32&&c.rsi14<=55],['3-candle decline',falling],
  ['volume >= 0.9x MA20',volumeRatio>=0.9]
 ] as const
 const best=(parts:readonly (readonly [string,boolean])[])=>({
  score:parts.filter(x=>x[1]).length,
  checks:parts.filter(x=>x[1]).map(x=>x[0]),
  missing:parts.filter(x=>!x[1]).map(x=>x[0])
 })
 const b=best(buy),s=best(sell)
 // Only report a qualified hypothesis when all directional confirmations agree.
 const direction:SetupDirection=b.score===5?'BUY':s.score===5?'SELL':'NONE'
 const primary=direction==='BUY'?b:direction==='SELL'?s:b.score>=s.score?b:s
 const kind=direction==='NONE'?'NO_QUALIFIED_SETUP':'TREND_CONTINUATION'
 return{
  source:'COMPLETED_OANDA_CANDLES',direction,kind,score:primary.score,maxScore:5,
  qualified:direction!=='NONE',rsi14:round(c.rsi14),rsiZone:classifyRsi(c.rsi14),
  spreadPips:round(spreadPips),checks:primary.checks,missing:primary.missing,
  details:direction==='NONE'
   ?'No fully confirmed continuation pattern; this is not a recommendation to trade.'
   :'A fully aligned, observational trend-continuation setup. It is not proof of positive expectancy.'
 }
}
export type WaitObservation={
 symbol:string;direction:'BUY'|'SELL';candleTime:string;entryMid:number;
 spreadPips:number;horizonCandles:3
}
export type WaitOutcome=WaitObservation&{
 evaluatedAt:string;exitMid:number;grossPips:number;estimatedCostsPips:number;
 netMovementPips:number;favorable:boolean
}
export function resolveWaitObservation(w:WaitObservation,m5:Candle[],slippagePipsPerSide:number):WaitOutcome|null{
 const at=m5.findIndex(x=>x.time===w.candleTime)
 if(at<0||at+3>=m5.length)return null
 const exit=m5[at+3]
 const gross=(w.direction==='BUY'?exit.close-w.entryMid:w.entryMid-exit.close)*10000
 const costs=w.spreadPips+2*slippagePipsPerSide
 const net=gross-costs
 return{...w,evaluatedAt:exit.time,exitMid:exit.close,grossPips:round(gross),
  estimatedCostsPips:round(costs),netMovementPips:round(net),favorable:net>0}
}
export function questionableRsiReason(reason:string,zone:RsiZone):boolean{
 const text=reason.toLowerCase()
 // Detect affirmative misclassification, not accurate claims such as "not oversold".
 const oversold=/\b(?:is|looks|appears|seems|suggests|indicates|shows|signals)\s+(?:somewhat\s+|potentially\s+|slightly\s+)?oversold\b/.test(text)
 const overbought=/\b(?:is|looks|appears|seems|suggests|indicates|shows|signals)\s+(?:somewhat\s+|potentially\s+|slightly\s+)?overbought\b/.test(text)
 return zone!=='OVERSOLD'&&oversold||zone!=='OVERBOUGHT'&&overbought
}
