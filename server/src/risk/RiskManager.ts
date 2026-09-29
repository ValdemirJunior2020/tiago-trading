import Decimal from'decimal.js'
import type{Direction,TradePlan}from'@profitmind/shared'
import{LIMITS}from'../config.js'
export class RiskManager{
 private eq:{t:number;e:Decimal}[]=[]
 hardStop(fill:string,d:Direction){const f=new Decimal(fill);return(d==='long'?f.mul(new Decimal(1).minus(LIMITS.hardStop)):f.mul(new Decimal(1).plus(LIMITS.hardStop))).toString()}
 spreadPct(bid:string,ask:string){const b=new Decimal(bid),a=new Decimal(ask);return a.minus(b).div(a.plus(b).div(2))}
 recordEquity(equity:string,t=Date.now()){this.eq.push({t,e:new Decimal(equity)});this.eq=this.eq.filter(x=>x.t>=t-86400000)}
 drawdown24h(){if(!this.eq.length)return new Decimal(0);const cur=this.eq.at(-1)!.e,peak=Decimal.max(...this.eq.map(x=>x.e));return peak.eq(0)?new Decimal(0):peak.minus(cur).div(peak)}
 locked(){return this.drawdown24h().gte(LIMITS.kill24h)}
 plan(symbol:string,direction:Direction,price:string,equity:string,reasons:string[]):TradePlan{if(this.locked())throw new Error('24h drawdown kill switch active');const stop=this.hardStop(price,direction),riskCash=new Decimal(equity).mul(LIMITS.riskPerTrade),distance=new Decimal(price).minus(stop).abs(),units=riskCash.div(distance).floor();return{symbol,direction,referencePrice:price,hardStop:stop,riskCash:riskCash.toString(),units:units.toString(),reasons}}
}
