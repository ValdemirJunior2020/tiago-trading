import { Router } from 'express'
import { Decimal } from 'decimal.js'

import { requireAuth } from '../middleware/auth.js'
import { db } from '../firebaseAdmin.js'
import { refreshUserEquity } from '../trading/equity.js'

export const leaderboardRouter = Router()

leaderboardRouter.use(requireAuth)

leaderboardRouter.get(
  '/',
  async (_req, res, next) => {
    try {
      // Do not order by the stored value before refreshing it.
      // Refresh each wallet first, then rank in memory.
      const wallets = await db()
        .collection('wallets')
        .limit(50)
        .get()

      const rows = await Promise.all(
        wallets.docs.map(async (walletDoc) => {
          let equity

          try {
            equity = await refreshUserEquity(
              walletDoc.id,
            )
          } catch (error) {
            console.error(
              `Could not refresh leaderboard equity for ${walletDoc.id}:`,
              error,
            )

            const wallet: any = walletDoc.data()

            equity = {
              portfolioValue:
                wallet.portfolioValue || '10000',
              totalReturnPercent:
                wallet.totalReturnPercent || '0',
            }
          }

          const profile = await db()
            .collection('profiles')
            .doc(walletDoc.id)
            .get()

          const profileData: any =
            profile.data()

          return {
            displayName:
              profileData?.displayName ||
              'Trader',
            portfolioValue:
              equity.portfolioValue,
            totalReturnPercent:
              equity.totalReturnPercent,
          }
        }),
      )

      rows.sort((a, b) =>
        new Decimal(b.totalReturnPercent)
          .cmp(
            new Decimal(
              a.totalReturnPercent,
            ),
          ),
      )

      res.json(
        rows.map((row, index) => ({
          rank: index + 1,
          ...row,
        })),
      )
    } catch (error) {
      next(error)
    }
  },
)
