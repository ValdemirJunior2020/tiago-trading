import { Decimal } from 'decimal.js'
import { FieldValue } from 'firebase-admin/firestore'

import { db } from '../firebaseAdmin.js'
import { marketService } from '../market/service.js'
import { livePnL } from './engine.js'

export type EquitySnapshot = {
  portfolioValue: string
  realizedPnL: string
  unrealizedPnL: string
  totalEquityPnL: string
  totalReturnPercent: string
}

export async function refreshUserEquity(
  uid: string,
): Promise<EquitySnapshot> {
  const walletRef = db()
    .collection('wallets')
    .doc(uid)

  const positionsRef = db()
    .collection('positions')
    .doc(uid)
    .collection('items')

  const [walletSnap, positionsSnap] = await Promise.all([
    walletRef.get(),
    positionsRef.where('status', '==', 'open').get(),
  ])

  if (!walletSnap.exists) {
    throw new Error('Virtual account not initialized')
  }

  const wallet: any = walletSnap.data()

  const virtualBalance = new Decimal(
    wallet.virtualBalance || '10000',
  )

  // wallet.totalPnL remains REALIZED P&L only.
  const realizedPnL = new Decimal(
    wallet.totalPnL || '0',
  )

  let unrealizedPnL = new Decimal(0)

  await Promise.all(
    positionsSnap.docs.map(async (positionDoc) => {
      const position: any = positionDoc.data()

      try {
        const quote = await marketService.quote(
          position.symbol,
          position.market,
        )

        const pnl = livePnL(
          position.direction,
          position.entryPrice,
          quote.price,
          position.quantity,
        )

        unrealizedPnL = unrealizedPnL.plus(pnl)

        await positionDoc.ref.update({
          currentPrice: quote.price,
          unrealizedPnL: pnl.toString(),
          priceFreshness: quote.freshness,
          priceUpdatedAt: quote.updatedAt,
        })
      } catch (error) {
        // If a provider is temporarily unavailable, use the last
        // saved unrealized P&L instead of inventing a market price.
        const savedPnL = new Decimal(
          position.unrealizedPnL || '0',
        )

        unrealizedPnL = unrealizedPnL.plus(savedPnL)

        console.error(
          `Could not refresh equity for position ${positionDoc.id}:`,
          error,
        )
      }
    }),
  )

  const portfolioValue =
    virtualBalance.plus(unrealizedPnL)

  const totalEquityPnL =
    realizedPnL.plus(unrealizedPnL)

  const totalReturnPercent =
    portfolioValue
      .minus(10000)
      .div(10000)
      .mul(100)

  await walletRef.update({
    portfolioValue: portfolioValue.toString(),
    unrealizedPnL: unrealizedPnL.toString(),
    totalEquityPnL: totalEquityPnL.toString(),
    totalReturnPercent: totalReturnPercent.toString(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return {
    portfolioValue: portfolioValue.toString(),
    realizedPnL: realizedPnL.toString(),
    unrealizedPnL: unrealizedPnL.toString(),
    totalEquityPnL: totalEquityPnL.toString(),
    totalReturnPercent: totalReturnPercent.toString(),
  }
}
