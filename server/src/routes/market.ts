import { Router } from 'express'
import { z } from 'zod'
import { marketService } from '../market/service.js'

export const marketRouter = Router()

const MarketSchema = z.enum([
  'stock',
  'crypto',
  'forex',
])

marketRouter.get(
  '/providers',
  (_req, res) => {
    res.json(marketService.status())
  },
)

marketRouter.get(
  '/quote',
  async (req, res, next) => {
    try {
      const query = z
        .object({
          symbol: z.string().min(1),
          market: MarketSchema,
        })
        .parse(req.query)

      const result = await marketService.quote(
        query.symbol,
        query.market,
      )

      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)

marketRouter.get(
  '/candles',
  async (req, res, next) => {
    try {
      const query = z
        .object({
          symbol: z.string().min(1),
          market: MarketSchema,
          timeframe: z
            .string()
            .default('1D'),
          limit: z.coerce
            .number()
            .min(10)
            .max(500)
            .default(120),
        })
        .parse(req.query)

      const result = await marketService.candles(
        query.symbol,
        query.market,
        query.timeframe,
        query.limit,
      )

      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)

marketRouter.get(
  '/search',
  async (req, res, next) => {
    try {
      const query = z
        .object({
          q: z.string().min(1),
          market: MarketSchema.optional(),
        })
        .parse(req.query)

      const result = await marketService.search(
        query.q,
        query.market,
      )

      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)