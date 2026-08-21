import {describe,it,expect} from 'vitest'; import {calculatePnL,calculateMargin,calculateForexPips,applySpread} from './index'
describe('financial math',()=>{
 it('long profit',()=>expect(calculatePnL('long',100,110,10).toString()).toBe('100'))
 it('short profit',()=>expect(calculatePnL('short',100,90,10).toString()).toBe('100'))
 it('long loss',()=>expect(calculatePnL('long',100,90,10).toString()).toBe('-100'))
 it('margin',()=>expect(calculateMargin(10000,10).toString()).toBe('1000'))
 it('forex pips',()=>expect(calculateForexPips('1.1000','1.1050','EUR/USD','long').toString()).toBe('50'))
 it('spread',()=>expect(applySpread(100,'0.2','buy').toString()).toBe('100.1'))
})
