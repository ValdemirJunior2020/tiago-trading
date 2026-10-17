import {Decimal} from 'decimal.js'

// Temporary Shadow 3/4 protection for NEW trades only.
// Never changes existing position size/stops, mathematical entry conditions, or Ollama.
export const SHADOW_MAX_NEW_TRADE_RISK_USD='50'
export const SHADOW_LOSS_COOLDOWN_MS=60*60*1000
export const SHADOW_PROFIT_COOLDOWN_MS=15*60*1000

export function cappedShadowPlanningCapital(shadowBalance:string,riskRate='0.0025'){
 const capital=new Decimal(shadowBalance),rate=new Decimal(riskRate)
 if(!capital.isFinite()||capital.lte(0)||!rate.isFinite()||rate.lte(0))throw Error('SHADOW_PROTECTION_INVALID_CAPITAL')
 return Decimal.min(capital,new Decimal(SHADOW_MAX_NEW_TRADE_RISK_USD).div(rate)).toString()
}

export function shadowLossCooldownUntil(at:string,pnl:string){
 const time=Date.parse(at),profit=new Decimal(pnl)
 if(!Number.isFinite(time)||!profit.isFinite())throw Error('SHADOW_PROTECTION_INVALID_CLOSE')
 return profit.lt(0)?new Date(time+SHADOW_LOSS_COOLDOWN_MS).toISOString():null
}

// The last completed Shadow close controls the new-entry pause; flat closes do not start one.
export function shadowCloseCooldownUntil(at:string,pnl:string){
 const time=Date.parse(at),profit=new Decimal(pnl)
 if(!Number.isFinite(time)||!profit.isFinite())throw Error('SHADOW_PROTECTION_INVALID_CLOSE')
 if(profit.lt(0))return new Date(time+SHADOW_LOSS_COOLDOWN_MS).toISOString()
 if(profit.gt(0))return new Date(time+SHADOW_PROFIT_COOLDOWN_MS).toISOString()
 return null
}

export function shadowCooldownRemainingMs(until:string|null|undefined,now=Date.now()){
 const time=until?Date.parse(until):NaN
 return Number.isFinite(time)?Math.max(0,time-now):0
}
