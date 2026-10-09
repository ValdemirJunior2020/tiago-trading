// The regular OANDA US forex session, in America/New_York wall-clock time.
// The broker's own tradeable quote/status remains authoritative on holidays.
// This gate must NEVER make a closed quote tradeable.
export type OandaMarketSession='OPEN'|'WEEKEND_CLOSED'|'DAILY_BREAK'
export function oandaForexSession(at:Date):OandaMarketSession{
 if(!Number.isFinite(at.getTime()))throw Error('Invalid session timestamp')
 const parts=new Intl.DateTimeFormat('en-US',{
  timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(at)
 const part=(type:string)=>parts.find(x=>x.type===type)?.value??''
 const day=part('weekday'),minute=Number(part('hour'))*60+Number(part('minute'))
 const cutoff=16*60+59,reopen=17*60+5
 if(day==='Sat'||day==='Sun'&&minute<reopen||day==='Fri'&&minute>=cutoff)return'WEEKEND_CLOSED'
 if(minute>=cutoff&&minute<reopen)return'DAILY_BREAK'
 return'OPEN'
}
export function isOandaForexSessionOpen(at:Date){return oandaForexSession(at)==='OPEN'}
