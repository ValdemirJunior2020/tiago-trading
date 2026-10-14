import{describe,it,expect}from'vitest'
import{cappedShadowPlanningCapital,shadowLossCooldownUntil,shadowCooldownRemainingMs}from'./ShadowProtection.js'
import{RiskManager}from'../risk/RiskManager.js'

describe('temporary Shadow-only loss guard',()=>{
 it('limits new trade planning cash risk to $50 even with $100k account',()=>{
  const capital=cappedShadowPlanningCapital('100000')
  expect(capital).toBe('20000')
  const r=new RiskManager(null).plan('GBP_USD','long','1.32000',capital,[])
  expect(Number(r.riskCash)).toBe(50)
  expect(new RiskManager(null).plan('GBP_USD','long','1.32000','100000',[]).riskCash).toBe('250')
 })
 it('does not increase small-account risk',()=>{
  expect(cappedShadowPlanningCapital('1000')).toBe('1000')
  expect(new RiskManager(null).plan('EUR_USD','long','1.10',cappedShadowPlanningCapital('1000'),[]).riskCash).toBe('2.5')
 })
 it('persists a one-hour cooldown after negative Shadow close',()=>{
  const until=shadowLossCooldownUntil('2026-10-14T10:00:00.000Z','-56.68')
  expect(until).toBe('2026-10-14T11:00:00.000Z')
  expect(shadowCooldownRemainingMs(until,Date.parse('2026-10-14T10:59:00Z'))).toBe(60000)
  expect(shadowCooldownRemainingMs(until,Date.parse('2026-10-14T11:01:00Z'))).toBe(0)
 })
 it('does not trigger a post-loss cooldown for wins or flat positions',()=>{
  expect(shadowLossCooldownUntil('2026-10-14T10:00:00Z','5.00')).toBeNull()
  expect(shadowLossCooldownUntil('2026-10-14T10:00:00Z','0')).toBeNull()
 })
})
