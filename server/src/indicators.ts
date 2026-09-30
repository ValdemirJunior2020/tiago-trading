export type Candle={time:string;open:number;high:number;low:number;close:number;volume:number}

export function sma(values:number[],period:number){
 if(values.length<period)throw new Error('Not enough values for SMA')
 const a=values.slice(-period)
 return a.reduce((s,v)=>s+v,0)/period
}

export function stddev(values:number[],period:number){
 const a=values.slice(-period),m=sma(values,period)
 return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/period)
}

export function rsi(values:number[],period=14){
 if(values.length<period+1)throw new Error('Not enough values for RSI')
 const a=values.slice(-(period+1))
 let gains=0,losses=0
 for(let i=1;i<a.length;i++){
  const d=a[i]-a[i-1]
  if(d>0)gains+=d
  else losses-=d
 }
 const avgGain=gains/period,avgLoss=losses/period
 if(avgLoss===0)return 100
 const rs=avgGain/avgLoss
 return 100-(100/(1+rs))
}

export function strategyContext(m5:Candle[],m10:Candle[]){
 if(m5.length<21||m10.length<20)throw new Error('Not enough closed candles')
 const c5=m5.map(x=>x.close),c10=m10.map(x=>x.close),vol=m5.map(x=>x.volume)
 const mid=sma(c5,20),sd=stddev(c5,20)
 const last=m5.at(-1)!
 return{
  macroClose:m10.at(-1)!.close,
  macroSma20:sma(c10,20),
  close:last.close,
  volume:last.volume,
  bbLower:mid-(2*sd),
  bbUpper:mid+(2*sd),
  rsi14:rsi(c5,14),
  vma20:sma(vol,20)
 }
}
