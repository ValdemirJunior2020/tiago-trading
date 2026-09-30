import{describe,it,expect}from'vitest'
import{RiskManager}from'./RiskManager.js'

describe('risk',()=>{
 it('calculates 0.8% long stop from fill',()=>expect(new RiskManager(null).hardStop('100','long')).toBe('99.2'))
 it('calculates 0.8% short stop from fill',()=>expect(new RiskManager(null).hardStop('100','short')).toBe('100.8'))
 it('locks at 3 percent rolling drawdown',()=>{
  const r=new RiskManager(null)
  r.recordEquity('10000',Date.now()-1000)
  r.recordEquity('9700')
  expect(r.locked()).toBe(true)
 })
 it('accepts fill at the slippage ceiling',()=>{
  const r=new RiskManager(null)
  expect(r.validateFill('100','100.1','long').hardStop).toBe('99.2992')
 })
 it('rejects fill beyond the slippage ceiling',()=>{
  const r=new RiskManager(null)
  expect(()=>r.validateFill('100','100.1001','long')).toThrow(/Slippage/)
 })
})
