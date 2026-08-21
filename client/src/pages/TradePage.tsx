import {
  useParams,
  useSearchParams,
  useNavigate,
} from 'react-router-dom'
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Decimal } from 'decimal.js'

import { api } from '../lib/api'
import { Money } from '../components/Money'
import { FreshnessBadge } from '../components/FreshnessBadge'
import { Term } from '../components/Tooltip'

export function TradePage() {
  const { symbol = '' } = useParams()
  const [sp] = useSearchParams()

  const market = (
    sp.get('market') || 'crypto'
  ) as 'stock' | 'crypto' | 'forex'

  const [direction, setDirection] =
    useState<'long' | 'short'>('long')

  const [tradeAmount, setTradeAmount] =
    useState('100')

  const [lev, setLev] = useState(
    market === 'forex' ? '10' : '1',
  )

  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')
  const [guided, setGuided] = useState(true)

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const quote = useQuery({
    queryKey: ['quote', symbol, market],
    queryFn: () =>
      api<any>(
        `/api/market/quote?symbol=${encodeURIComponent(
          symbol,
        )}&market=${market}`,
      ),
    refetchInterval: 8000,
  })

  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () =>
      api<any>('/api/account/summary'),
  })

  const calc = useMemo(() => {
    if (!quote.data) {
      return null
    }

    try {
      const price = new Decimal(
        quote.data.price,
      )

      const amount = new Decimal(
        tradeAmount || 0,
      )

      const leverage = new Decimal(
        lev || 1,
      )

      if (
        price.lte(0) ||
        amount.lte(0)
      ) {
        return null
      }

      // User enters USD exposure.
      // Quantity is calculated automatically.
      const quantity = amount.div(price)

      const exposure = price.mul(quantity)

      const margin =
        exposure.div(leverage)

      const risk = sl
        ? price
            .minus(sl)
            .abs()
            .mul(quantity)
        : null

      const reward = tp
        ? new Decimal(tp)
            .minus(price)
            .abs()
            .mul(quantity)
        : null

      const rr =
        risk &&
        reward &&
        !risk.eq(0)
          ? reward.div(risk)
          : null

      return {
        price,
        amount,
        quantity,
        exposure,
        margin,
        risk,
        reward,
        rr,
      }
    } catch {
      return null
    }
  }, [
    quote.data,
    tradeAmount,
    lev,
    sl,
    tp,
  ])

  const mutation = useMutation({
    mutationFn: () => {
      if (!calc) {
        throw new Error(
          'Enter a valid trade amount.',
        )
      }

      return api<any>(
        '/api/trade/open',
        {
          method: 'POST',
          body: JSON.stringify({
            symbol,
            market,
            direction,

            // Backend still receives quantity.
            quantity:
              calc.quantity.toFixed(8),

            leverage: lev,

            stopLoss:
              sl || null,

            takeProfit:
              tp || null,
          }),
        },
      )
    },

    onSuccess: () => {
      queryClient.invalidateQueries()
      navigate('/portfolio')
    },
  })

  if (quote.error) {
    return (
      <div className="errorCard">
        {(quote.error as Error).message}

        <br />

        <small>
          A simulated order can't be
          opened without a real provider
          price.
        </small>
      </div>
    )
  }

  return (
    <>
      <header className="pageHead">
        <div>
          <span className="eyebrow">
            Guided Trade · simulated only
          </span>

          <h1>{symbol}</h1>

          <p>
            Choose how much virtual money
            you want to trade.
          </p>
        </div>

        <label className="switch">
          <input
            type="checkbox"
            checked={guided}
            onChange={(event) =>
              setGuided(
                event.target.checked,
              )
            }
          />

          Guided Trade
        </label>
      </header>

      <div className="tradeLayout">
        <section className="panel tradeForm">
          {guided && (
            <div className="guideStep">
              <b>Step 1–2</b>

              <span>
                Do you think {symbol} will
                go up or down?
              </span>
            </div>
          )}

          <div className="segmented">
            <button
              type="button"
              className={
                direction === 'long'
                  ? 'active positiveBtn'
                  : ''
              }
              onClick={() =>
                setDirection('long')
              }
            >
              LONG / BUY
            </button>

            <button
              type="button"
              className={
                direction === 'short'
                  ? 'active negativeBtn'
                  : ''
              }
              onClick={() =>
                setDirection('short')
              }
            >
              SHORT / SELL
            </button>
          </div>

          {quote.data && (
            <div className="quoteStrip">
              <span>
                Latest price
              </span>

              <strong>
                <Money
                  value={
                    quote.data.price
                  }
                />
              </strong>

              <FreshnessBadge
                value={
                  quote.data.freshness
                }
              />

              <small>
                Updated{' '}
                {new Date(
                  quote.data.updatedAt,
                ).toLocaleTimeString()}
              </small>
            </div>
          )}

          {guided && (
            <div className="guideStep">
              <b>Step 3</b>

              <span>
                Enter how many dollars of
                virtual market exposure you
                want.
              </span>
            </div>
          )}

          <div className="formGrid">
            <label>
              <span>
                Amount to trade
              </span>

              <div
                style={{
                  position: 'relative',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform:
                      'translateY(-50%)',
                    fontWeight: 800,
                    color: '#64748b',
                  }}
                >
                  $
                </span>

                <input
                  inputMode="decimal"
                  value={tradeAmount}
                  onChange={(event) =>
                    setTradeAmount(
                      event.target.value,
                    )
                  }
                  placeholder="5000"
                  style={{
                    width: '100%',
                    paddingLeft: 28,
                  }}
                />
              </div>

              <small>
                Example: enter 5000 to
                operate about $5,000.
              </small>
            </label>

            {market === 'forex' && (
              <label>
                <span>
                  <Term
                    term="Leverage"
                    text="1:10 means each $1 of virtual margin controls $10 of simulated market exposure."
                  />
                </span>

                <select
                  value={lev}
                  onChange={(event) =>
                    setLev(
                      event.target.value,
                    )
                  }
                >
                  {[
                    '1',
                    '2',
                    '5',
                    '10',
                    '20',
                    '50',
                  ].map((value) => (
                    <option
                      key={value}
                      value={value}
                    >
                      1:{value}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label>
              <span>
                <Term
                  term="Stop Loss"
                  text="A simulated exit level designed to limit loss if price moves against you."
                />
              </span>

              <input
                inputMode="decimal"
                placeholder="Optional"
                value={sl}
                onChange={(event) =>
                  setSl(
                    event.target.value,
                  )
                }
              />
            </label>

            <label>
              <span>
                <Term
                  term="Take Profit"
                  text="A simulated target that closes the position when your target price is reached."
                />
              </span>

              <input
                inputMode="decimal"
                placeholder="Optional"
                value={tp}
                onChange={(event) =>
                  setTp(
                    event.target.value,
                  )
                }
              />
            </label>
          </div>

          {calc && (
            <div className="guideStep">
              <b>
                Position calculated
              </b>

              <span>
                {calc.quantity.toFixed(
                  market === 'forex'
                    ? 2
                    : 6,
                )}{' '}
                units of {symbol}
              </span>
            </div>
          )}

          {mutation.error && (
            <div className="errorCard">
              {
                (
                  mutation.error as Error
                ).message
              }
            </div>
          )}

          <button
            type="button"
            className="primary big"
            disabled={
              !quote.data ||
              !calc ||
              mutation.isPending
            }
            onClick={() =>
              mutation.mutate()
            }
          >
            {mutation.isPending
              ? 'Opening…'
              : direction === 'long'
                ? `Buy ${symbol} with $${tradeAmount || '0'}`
                : `Sell / Short ${symbol} with $${tradeAmount || '0'}`}
          </button>
        </section>

        <aside className="panel riskPanel">
          <span className="eyebrow">
            Risk Panel
          </span>

          <h2>
            Review the trade
          </h2>

          <dl>
            <div>
              <dt>
                Account size
              </dt>

              <dd>
                <Money
                  value={
                    summary.data
                      ?.wallet
                      ?.portfolioValue
                  }
                />
              </dd>
            </div>

            <div>
              <dt>
                Amount selected
              </dt>

              <dd>
                <Money
                  value={
                    calc?.amount.toString()
                  }
                />
              </dd>
            </div>

            <div>
              <dt>
                Calculated quantity
              </dt>

              <dd>
                {calc
                  ? calc.quantity.toFixed(
                      market ===
                        'forex'
                        ? 2
                        : 6,
                    )
                  : '—'}
              </dd>
            </div>

            <div>
              <dt>
                Position exposure
              </dt>

              <dd>
                <Money
                  value={
                    calc?.exposure.toString()
                  }
                />
              </dd>
            </div>

            <div>
              <dt>
                Margin used
              </dt>

              <dd>
                <Money
                  value={
                    calc?.margin.toString()
                  }
                />
              </dd>
            </div>

            <div>
              <dt>
                Potential loss at stop
              </dt>

              <dd>
                {calc?.risk ? (
                  <Money
                    value={
                      calc.risk.toString()
                    }
                  />
                ) : (
                  <span>
                    Not set
                  </span>
                )}
              </dd>
            </div>

            <div>
              <dt>
                Potential profit at target
              </dt>

              <dd>
                {calc?.reward ? (
                  <Money
                    value={
                      calc.reward.toString()
                    }
                  />
                ) : (
                  <span>
                    Not set
                  </span>
                )}
              </dd>
            </div>

            <div>
              <dt>
                Risk / Reward
              </dt>

              <dd>
                {calc?.rr
                  ? `1 : ${calc.rr.toFixed(
                      2,
                    )}`
                  : '—'}
              </dd>
            </div>

            <div>
              <dt>
                Buying power
              </dt>

              <dd>
                <Money
                  value={
                    summary.data
                      ?.wallet
                      ?.buyingPower
                  }
                />
              </dd>
            </div>
          </dl>

          <p className="riskNote">
            This is education, not
            financial advice. Leverage
            controls only a simulated
            position.
          </p>
        </aside>
      </div>
    </>
  )
}