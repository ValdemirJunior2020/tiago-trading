import {describe,it,expect} from 'vitest'
import {evaluateFimatheProxy} from './FimathePaperEngine.js'
const bars=(closes:number[])=>closes.map((close,i)=>({time:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),open:close,close,high:close+0.00005,low:close-0.00005,volume:100}))
const day=(open:number,close:number)=>[{time:'D',open,close,high:Math.max(open,close),low:Math.min(open,close),volume:100}]
describe('independent Fimathe experimental proxy evaluator',()=>{
 it('does not signal with insufficient closed candles',()=>expect(evaluateFimatheProxy(bars([1.1]),day(1,2)).side).toBe('WAIT'))
 it('detects an M1 breakout only with bullish completed daily bias',()=>{
  const m1=bars([...Array(21).fill(1.1),1.102])
  expect(evaluateFimatheProxy(m1,day(1.09,1.11)).side).toBe('LONG')
  expect(evaluateFimatheProxy(m1,day(1.12,1.11)).side).toBe('WAIT')
 })
 it('detects breakdown with bearish bias',()=>{
  const m1=bars([...Array(21).fill(1.1),1.098])
  expect(evaluateFimatheProxy(m1,day(1.12,1.11)).side).toBe('SHORT')
 })
 it('stays flat without a confirmed breakout',()=>{
  expect(evaluateFimatheProxy(bars(Array(22).fill(1.1)),day(1.09,1.11)).side).toBe('WAIT')
 })
})
