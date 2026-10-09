import{describe,it,expect}from'vitest'
import{oandaForexSession,isOandaForexSessionOpen}from'./OandaMarketHours.js'
const at=(iso:string)=>new Date(iso)
describe('OANDA regular forex market-hours safety in New York time',()=>{
 it('refuses new forex entries after 16:59 Friday through 17:05 Sunday (EDT)',()=>{
  expect(oandaForexSession(at('2026-10-09T20:58:00Z'))).toBe('OPEN')
  expect(oandaForexSession(at('2026-10-09T20:59:00Z'))).toBe('WEEKEND_CLOSED')
  expect(oandaForexSession(at('2026-10-09T21:08:00Z'))).toBe('WEEKEND_CLOSED')
  expect(oandaForexSession(at('2026-10-10T18:00:00Z'))).toBe('WEEKEND_CLOSED')
  expect(oandaForexSession(at('2026-10-11T21:04:00Z'))).toBe('WEEKEND_CLOSED')
  expect(oandaForexSession(at('2026-10-11T21:05:00Z'))).toBe('OPEN')
  expect(isOandaForexSessionOpen(at('2026-10-09T21:08:00Z'))).toBe(false)
 })
 it('observes weekday 16:59–17:05 maintenance instead of trading on a stale quote',()=>{
  expect(oandaForexSession(at('2026-10-08T20:58:00Z'))).toBe('OPEN')
  expect(oandaForexSession(at('2026-10-08T20:59:00Z'))).toBe('DAILY_BREAK')
  expect(oandaForexSession(at('2026-10-08T21:04:00Z'))).toBe('DAILY_BREAK')
  expect(oandaForexSession(at('2026-10-08T21:05:00Z'))).toBe('OPEN')
 })
 it('uses local New York clock through winter EST rather than fixed UTC offset',()=>{
  expect(oandaForexSession(at('2026-11-06T21:58:00Z'))).toBe('OPEN')
  expect(oandaForexSession(at('2026-11-06T21:59:00Z'))).toBe('WEEKEND_CLOSED')
  expect(oandaForexSession(at('2026-11-08T22:04:00Z'))).toBe('WEEKEND_CLOSED')
  expect(oandaForexSession(at('2026-11-08T22:05:00Z'))).toBe('OPEN')
 })
})
