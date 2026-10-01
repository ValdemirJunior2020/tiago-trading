import type{StrategySignal}from'@profitmind/shared'

export type Context={
 macroClose:number
 macroSma20:number
 close:number
 volume:number
 bbLower:number
 bbUpper:number
 rsi14:number
 vma20:number
}

export type CandidateAnalysis={
 side:'LONG'|'SHORT'|null
 matched:number
 total:number
 missing:string[]
 matchedConditions:string[]
}

export function analyzeCandidate(c:Context):CandidateAnalysis{
 const long=[
  {name:'10m bullish',ok:c.macroClose>c.macroSma20},
  {name:'lower BB breach',ok:c.close<c.bbLower},
  {name:'RSI<30',ok:c.rsi14<30},
  {name:'volume spike',ok:c.volume>=c.vma20*1.5}
 ]
 const short=[
  {name:'10m bearish',ok:c.macroClose<c.macroSma20},
  {name:'upper BB breach',ok:c.close>c.bbUpper},
  {name:'RSI>70',ok:c.rsi14>70},
  {name:'volume spike',ok:c.volume>=c.vma20*1.5}
 ]
 const score=(x:typeof long)=>({
  matched:x.filter(v=>v.ok).length,
  missing:x.filter(v=>!v.ok).map(v=>v.name),
  matchedConditions:x.filter(v=>v.ok).map(v=>v.name)
 })
 const l=score(long),s=score(short)
 if(l.matched===3&&l.matched>s.matched)return{side:'LONG',matched:l.matched,total:4,missing:l.missing,matchedConditions:l.matchedConditions}
 if(s.matched===3&&s.matched>l.matched)return{side:'SHORT',matched:s.matched,total:4,missing:s.missing,matchedConditions:s.matchedConditions}
 return{side:null,matched:Math.max(l.matched,s.matched),total:4,missing:[],matchedConditions:[]}
}

export function evaluate(c:Context):StrategySignal{
 if(c.macroClose>c.macroSma20&&c.close<c.bbLower&&c.rsi14<30&&c.volume>=c.vma20*1.5)
  return{decision:'LONG',confidence:1,reasons:['10m bullish','lower BB breach','RSI<30','volume spike']}
 if(c.macroClose<c.macroSma20&&c.close>c.bbUpper&&c.rsi14>70&&c.volume>=c.vma20*1.5)
  return{decision:'SHORT',confidence:1,reasons:['10m bearish','upper BB breach','RSI>70','volume spike']}
 return{decision:'WAIT',confidence:0,reasons:['Conditions not aligned']}
}
