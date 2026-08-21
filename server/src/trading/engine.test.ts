import { describe, it, expect } from 'vitest'
import {
  validateOrder,
  normalizedLeverage,
} from './engine.js'

describe('trade engine', () => {
  it('rejects insufficient BP', () => {
    expect(() =>
      validateOrder({
        price: '100',
        quantity: '20',
        leverage: '1',
        buyingPower: '1000',
      }),
    ).toThrow()
  })

  it('forex leverage', () => {
    expect(
      normalizedLeverage('forex', '10').toString(),
    ).toBe('10')
  })

  it('stock leverage forced 1', () => {
    expect(
      normalizedLeverage('stock', '10').toString(),
    ).toBe('1')
  })
})