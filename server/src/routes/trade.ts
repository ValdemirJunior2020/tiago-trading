import { Router } from 'express'
import { z } from 'zod'
import { Decimal } from 'decimal.js'
import { FieldValue } from 'firebase-admin/firestore'

import { db } from '../firebaseAdmin.js'
import {
  requireAuth,
  type AuthedRequest,
} from '../middleware/auth.js'
import { marketService } from '../market/service.js'
import {
  normalizedLeverage,
  validateOrder,
  livePnL,
} from '../trading/engine.js'

export const tradeRouter = Router()

tradeRouter.use(requireAuth)

const schema = z.object({
  symbol: z.string().min(1),
  market: z.enum(['stock', 'crypto', 'forex']),
  direction: z.enum(['long', 'short']),
  quantity: z.string().min(1),
  leverage: z.string().default('1'),
  stopLoss: z.string().nullable().optional(),
  takeProfit: z.string().nullable().optional(),
})

function firstString(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

async function settlePosition(
  uid: string,
  id: string,
  exitPrice: string,
  reason: 'manual' | 'stop-loss' | 'take-profit',
) {
  const positionRef = db()
    .collection('positions')
    .doc(uid)
    .collection('items')
    .doc(id)

  const walletRef = db()
    .collection('wallets')
    .doc(uid)

  const tradeRef = db()
    .collection('trades')
    .doc(uid)
    .collection('items')
    .doc()

  let result = {
    pnl: '0',
  }

  await db().runTransaction(async (tx) => {
    // All transaction reads happen before writes.
    const [positionSnap, walletSnap] = await Promise.all([
      tx.get(positionRef),
      tx.get(walletRef),
    ])

    if (
      !positionSnap.exists ||
      positionSnap.data()?.status !== 'open'
    ) {
      throw new Error('Open position not found')
    }

    if (!walletSnap.exists) {
      throw new Error('Virtual account not initialized')
    }

    const position: any = positionSnap.data()
    const wallet: any = walletSnap.data()

    const pnl = livePnL(
      position.direction,
      position.entryPrice,
      exitPrice,
      position.quantity,
    )

    const balance = new Decimal(
      wallet.virtualBalance || '0',
    ).plus(pnl)

    const buyingPower = new Decimal(
      wallet.buyingPower || '0',
    )
      .plus(position.marginUsed || '0')
      .plus(pnl)

    const totalPnL = new Decimal(
      wallet.totalPnL || '0',
    ).plus(pnl)

    tx.update(walletRef, {
      virtualBalance: balance.toString(),
      buyingPower: buyingPower.toString(),
      portfolioValue: balance.toString(),
      totalPnL: totalPnL.toString(),
      totalReturnPercent: totalPnL
        .div(10000)
        .mul(100)
        .toString(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    tx.update(positionRef, {
      status: 'closed',
      currentPrice: exitPrice,
      unrealizedPnL: pnl.toString(),
      closedAt: new Date().toISOString(),
      closeReason: reason,
    })

    tx.set(tradeRef, {
      ...position,
      positionId: positionRef.id,
      exitPrice,
      pnl: pnl.toString(),
      closedAt: new Date().toISOString(),
      closeReason: reason,
    })

    result = {
      pnl: pnl.toString(),
    }
  })

  return result
}

tradeRouter.post(
  '/open',
  async (req: AuthedRequest, res, next) => {
    try {
      const input = schema.parse(req.body)
      const uid = req.uid

      if (!uid) {
        return res.status(401).json({
          error: 'Authentication required',
        })
      }

      const quote = await marketService.quote(
        input.symbol,
        input.market,
      )

      const leverage = normalizedLeverage(
        input.market,
        input.leverage,
      )

      const walletRef = db()
        .collection('wallets')
        .doc(uid)

      const positionRef = db()
        .collection('positions')
        .doc(uid)
        .collection('items')
        .doc()

      await db().runTransaction(async (tx) => {
        const walletSnap = await tx.get(walletRef)

        if (!walletSnap.exists) {
          throw new Error(
            'Virtual account not initialized',
          )
        }

        const wallet = walletSnap.data()!

        const { margin } = validateOrder({
          price: quote.price,
          quantity: input.quantity,
          leverage: leverage.toString(),
          buyingPower: wallet.buyingPower,
        })

        const price = new Decimal(quote.price)

        if (input.stopLoss) {
          const stopLoss = new Decimal(input.stopLoss)

          if (
            input.direction === 'long' &&
            stopLoss.gte(price)
          ) {
            throw new Error(
              'Long Stop Loss must be below entry price',
            )
          }

          if (
            input.direction === 'short' &&
            stopLoss.lte(price)
          ) {
            throw new Error(
              'Short Stop Loss must be above entry price',
            )
          }
        }

        if (input.takeProfit) {
          const takeProfit = new Decimal(
            input.takeProfit,
          )

          if (
            input.direction === 'long' &&
            takeProfit.lte(price)
          ) {
            throw new Error(
              'Long Take Profit must be above entry price',
            )
          }

          if (
            input.direction === 'short' &&
            takeProfit.gte(price)
          ) {
            throw new Error(
              'Short Take Profit must be below entry price',
            )
          }
        }

        const buyingPower = new Decimal(
          wallet.buyingPower,
        ).minus(margin)

        // Writes only after all transaction reads.
        tx.update(walletRef, {
          buyingPower: buyingPower.toString(),
          updatedAt: FieldValue.serverTimestamp(),
        })

        tx.set(positionRef, {
          symbol: input.symbol,
          market: input.market,
          direction: input.direction,
          quantity: input.quantity,
          entryPrice: quote.price,
          currentPrice: quote.price,
          unrealizedPnL: '0',
          stopLoss: input.stopLoss || null,
          takeProfit: input.takeProfit || null,
          leverage: leverage.toString(),
          marginUsed: margin.toString(),
          status: 'open',
          openedAt: new Date().toISOString(),
        })
      })

      return res.json({
        ok: true,
        positionId: positionRef.id,
        executionPrice: quote.price,
        updatedAt: quote.updatedAt,
      })
    } catch (error) {
      next(error)
    }
  },
)

tradeRouter.post(
  '/close/:id',
  async (req: AuthedRequest, res, next) => {
    try {
      const uid = req.uid

      if (!uid) {
        return res.status(401).json({
          error: 'Authentication required',
        })
      }

      const id = firstString(req.params.id)

      if (!id) {
        return res.status(400).json({
          error: 'Position id is required',
        })
      }

      const positionRef = db()
        .collection('positions')
        .doc(uid)
        .collection('items')
        .doc(id)

      const positionSnap = await positionRef.get()

      if (
        !positionSnap.exists ||
        positionSnap.data()?.status !== 'open'
      ) {
        return res.status(404).json({
          error: 'Open position not found',
        })
      }

      const position: any = positionSnap.data()

      const quote = await marketService.quote(
        position.symbol,
        position.market,
      )

      const result = await settlePosition(
        uid,
        id,
        quote.price,
        'manual',
      )

      return res.json({
        ok: true,
        pnl: result.pnl,
        exitPrice: quote.price,
      })
    } catch (error) {
      next(error)
    }
  },
)

tradeRouter.get(
  '/positions',
  async (req: AuthedRequest, res, next) => {
    try {
      const uid = req.uid

      if (!uid) {
        return res.status(401).json({
          error: 'Authentication required',
        })
      }

      const snapshot = await db()
        .collection('positions')
        .doc(uid)
        .collection('items')
        .where('status', '==', 'open')
        .get()

      const rows: any[] = []

      for (const document of snapshot.docs) {
        const position: any = document.data()

        try {
          const quote = await marketService.quote(
            position.symbol,
            position.market,
          )

          const current = new Decimal(quote.price)

          const hitStop =
            Boolean(position.stopLoss) &&
            (position.direction === 'long'
              ? current.lte(position.stopLoss)
              : current.gte(position.stopLoss))

          const hitTarget =
            Boolean(position.takeProfit) &&
            (position.direction === 'long'
              ? current.gte(position.takeProfit)
              : current.lte(position.takeProfit))

          if (hitStop || hitTarget) {
            await settlePosition(
              uid,
              document.id,
              quote.price,
              hitStop
                ? 'stop-loss'
                : 'take-profit',
            )

            continue
          }

          rows.push({
            id: document.id,
            ...position,
            currentPrice: quote.price,
            unrealizedPnL: livePnL(
              position.direction,
              position.entryPrice,
              quote.price,
              position.quantity,
            ).toString(),
            priceFreshness: quote.freshness,
            priceUpdatedAt: quote.updatedAt,
          })
        } catch (error) {
          console.error(
            `Could not refresh position ${document.id}:`,
            error,
          )

          rows.push({
            id: document.id,
            ...position,
            priceFreshness: 'CACHED',
          })
        }
      }

      return res.json(rows)
    } catch (error) {
      next(error)
    }
  },
)
