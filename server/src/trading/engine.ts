import { Decimal } from 'decimal.js'
import {
  calculateExposure,
  calculateMargin,
  calculatePnL,
  type Direction,
  type MarketType,
} from '@tiago/shared'

export function validateOrder(input: {
  price: string
  quantity: string
  leverage: string
  buyingPower: string
}) {
  const price = new Decimal(input.price)
  const quantity = new Decimal(input.quantity)
  const leverage = new Decimal(input.leverage)
  const buyingPower = new Decimal(input.buyingPower)

  if (price.lte(0) || quantity.lte(0)) {
    throw new Error(
      'Price and quantity must be positive',
    )
  }

  if (leverage.lt(1) || leverage.gt(50)) {
    throw new Error(
      'Leverage must be between 1 and 50',
    )
  }

  const exposure = calculateExposure(
    price,
    quantity,
  )

  const margin = calculateMargin(
    exposure,
    leverage,
  )

  if (margin.gt(buyingPower)) {
    throw new Error(
      'Insufficient virtual buying power',
    )
  }

  return {
    exposure,
    margin,
  }
}

export function livePnL(
  direction: Direction,
  entry: string,
  current: string,
  quantity: string,
) {
  return calculatePnL(
    direction,
    entry,
    current,
    quantity,
  )
}

export function normalizedLeverage(
  market: MarketType,
  requested: string,
) {
  const leverage = new Decimal(requested)

  if (market !== 'forex' && leverage.gt(1)) {
    return new Decimal(1)
  }

  return leverage
}
