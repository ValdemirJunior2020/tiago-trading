import { Decimal } from 'decimal.js'
import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '../../.env') })

const s = z.object({
  PORT: z.coerce.number().default(8790),
  CLIENT_ORIGIN: z.string().default('http://127.0.0.1:5173'),
  OANDA_ACCOUNT_ID: z.string().default(''),
  OANDA_API_TOKEN: z.string().default(''),
  OANDA_REST_BASE_URL: z.string().default('https://api-fxpractice.oanda.com'),
  OANDA_DEMO_MIRROR_ENABLED: z.string().default('true'),
  OLLAMA_OANDA_PRACTICE_MIRROR_ENABLED: z.string().default('true'),
  OLLAMA_BASE_URL: z.string().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('qwen3:8b'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().default(2000),
  TRADE_PAIRS: z.string().default('EUR_USD,GBP_USD,USD_JPY'),
  SHADOW_OANDA_POLL_MS: z.coerce.number().default(30000)
})

export const env = s.parse(process.env)

export const LIMITS = Object.freeze({
  hardStop: new Decimal('0.008'),
  maxSlippage: new Decimal('0.001'),
  kill24h: new Decimal('0.03'),
  riskPerTrade: new Decimal('0.0025')
})

export const BROKER_MODE = env.OANDA_REST_BASE_URL.replace(/\/$/,'')==='https://api-fxpractice.oanda.com' ? 'DEMO' : 'DISABLED'
export const OANDA_DEMO_MIRROR_ENABLED = env.OANDA_DEMO_MIRROR_ENABLED.toLowerCase()==='true' && BROKER_MODE==='DEMO'

export const SHADOW_OANDA_PAIRS = env.TRADE_PAIRS.split(',').map(x=>x.trim()).filter(Boolean)

// Do not initialize this service against OANDA Live without a separate, explicit implementation.
if(BROKER_MODE!=='DEMO')throw new Error('Only OANDA Practice is supported; LIVE endpoint is disabled')
