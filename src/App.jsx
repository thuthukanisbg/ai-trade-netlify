// src/App.jsx
import React, { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend
} from 'chart.js'

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend)

const WATCH = ['AAPL', 'MSFT', 'EURUSD', 'USDZAR']

export default function App() {
  // Controls (keep defaults same as your earlier build)
  const [marketType, setMarketType] = useState('stock')        // 'stock' | 'forex'
  const [symbol, setSymbol] = useState('AAPL')
  const [interval, setIntervalSel] = useState('DAILY')         // 'DAILY' | 'INTRADAY'
  const [spreadBps, setSpreadBps] = useState(5)
  const [riskPct, setRiskPct] = useState(1)
  const [lookback, setLookback] = useState(220)

  // State
  const [loading, setLoading] = useState(false)
  const [resp, setResp] = useState(null)   // server response
  const [error, setError] = useState(null) // human-readable error

  // ---- fetch + validation (SAFE) ----
  async function run() {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({
        marketType,
        symbol,
        interval,
        spreadBps: String(spreadBps),
        riskPct: String(riskPct),
        lookback: String(lookback),
      }).toString()

      // NOTE: /api/* redirected to Netlify Functions by netlify.toml
      const r = await fetch(`/api/predict?${q}`)
      const j = await r.json().catch(() => ({}))

      if (!r.ok || j?.error) {
        throw new Error(j?.error || `Server error (${r.status})`)
      }
      if (!j || !Array.isArray(j.series) || j.series.length === 0) {
        throw new Error('No time-series data returned. Try Daily or wait ~60s (API rate limit).')
      }

      // Ensure backtest object exists (prevents UI crashes)
      j.backtest = j.backtest || { trades: 0, winRate: 0, avgTrade: 0, cumulative: 0 }

      setResp(j)
    } catch (e) {
      setResp(null)
      setError(e.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    run() // initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Chart data (guarded) ----
  const chartData = resp && Array.isArray(resp.series)
    ? {
        labels: resp.series.map(p => (p?.t ? dayjs(p.t).format('YYYY-MM-DD') : '')),
        datasets: [{
          label: `${resp?.symbol ?? symbol} close`,
          data: resp.series.map(p => Number(p?.close ?? 0)),
          tension: 0.25,
          borderColor: '#2563eb'
        }]
      }
    : { labels: [], datasets: [] }

  return (
    <div className="container">
      <h1>AI Trade Pilot</h1>
      <p className="small">Educational demo only. Not financial advice.</p>

      {/* Controls */}
      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <div style={{ minWidth: 140 }}>
            <label>Market</label>
            <select className="select" value={marketType} onChange={(e) => setMarketType(e.target.value)}>
              <option value="stock">Stock</option>
              <option value="forex">Forex</option>
            </select>
          </div>

          <input
            className="input"
            placeholder="Symbol e.g. AAPL or EURUSD"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          />

          <div style={{ minWidth: 160 }}>
            <label>Interval</label>
            <select className="select" value={interval} onChange={(e) => setIntervalSel(e.target.value)}>
              <option value="DAILY">Daily</option>
              <option value="INTRADAY">Intraday (60m)</option>
            </select>
          </div>

          <div style={{ minWidth: 140 }}>
            <label>Spread (bps)</label>
            <input
              className="input"
              type="number"
              value={spreadBps}
              onChange={(e) => setSpreadBps(Number(e.target.value))}
            />
          </div>

          <div style={{ minWidth: 160 }}>
            <label>Risk per trade (%)</label>
            <input
              className="input"
              type="number"
              value={riskPct}
              onChange={(e) => setRiskPct(Number(e.target.value))}
            />
          </div>

          <div style={{ minWidth: 160 }}>
            <label>Lookback bars</label>
            <input
              className="input"
              type="number"
              value={lookback}
              onChange={(e) => setLookback(Number(e.target.value))}
            />
          </div>

          <button className="btn" onClick={run} disabled={loading}>
            {loading ? 'Running…' : 'Predict'}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 12, color: '#b91c1c' }}>
            Error: {error}
          </div>
        )}
      </div>

      {/* Fallback banner when backend used simulated data */}
      {resp?.usingFallback && (
        <div className="card" style={{ border: '1px solid #fde68a', background: '#fffbeb' }}>
          <strong>Heads up:</strong> Using simulated data due to API limits/unavailable intraday feed.{' '}
          Switch to <em>Daily</em> or wait ~60s and try again.
        </div>
      )}

      {/* Main content */}
      {resp && (
        <div className="grid">
          <div className="card">
            <h2>Price</h2>
            <Line data={chartData} />
          </div>

          <div className="card">
            <h2>Signal &amp; Sizing</h2>
            <table className="table">
              <tbody>
                <tr><th>Symbol</th><td>{resp.symbol}</td></tr>
                <tr><th>Market</th><td>{resp.marketType}</td></tr>
                <tr><th>Interval</th><td>{resp.interval}</td></tr>
                <tr><th>Direction</th><td><span className="badge">{resp.direction}</span></td></tr>
                <tr><th>Confidence</th><td>{resp.confidence}%</td></tr>
                <tr><th>Prob Up</th><td>{resp.probUp?.toFixed ? resp.probUp.toFixed(3) : String(resp.probUp)}</td></tr>
                <tr><th>Position Size (units)</th><td>{resp.positionSize}</td></tr>
                <tr><th>Stop (% of price)</th><td>{(resp.stopPct * 100).toFixed(2)}%</td></tr>
                <tr><th>Spread</th><td>{(resp.spreadPct * 100).toFixed(3)}%</td></tr>
                <tr><th>Expected Edge</th><td>{(resp.expectedEdge * 100).toFixed(3)}%</td></tr>
              </tbody>
            </table>
            <p className="small">Sizing uses a 2×ATR-style stop from recent volatility and your risk %.</p>
          </div>
        </div>
      )}

      {resp && (
        <div className="card">
          <h2>Quick Backtest (in-sample)</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Trades</th>
                <th>Win Rate</th>
                <th>Avg Trade</th>
                <th>Cumulative</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{resp.backtest.trades}</td>
                <td>{resp.backtest.winRate}%</td>
                <td>{(resp.backtest.avgTrade * 100).toFixed(2)}%</td>
                <td>{(resp.backtest.cumulative * 100).toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
          <p className="small">In-sample demo only; validate out-of-sample before any real trading.</p>
        </div>
      )}

      <div className="card">
        <h2>Starter Watchlist</h2>
        <div className="row">
          {WATCH.map(s => (
            <button
              key={s}
              className="btn"
              onClick={() => {
                setSymbol(s)
                setMarketType(/^[A-Z]{6}$/.test(s) ? 'forex' : 'stock')
                run()
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Strategy Notes</h2>
        <div className="code">
{`Features: returns (1, 5 bars), SMA5/SMA20 ratio, MACD, normalized RSI
Model: logistic regression (on-the-fly)
Signal: LONG if P(up) >= 0.5 else SHORT; confidence scales with |P-0.5|
Sizing: risk-based with 2×ATR-lite stop; spread deducted from expected edge
Backtest: naive next-bar, includes stop & spread; in-sample only

⚠️ Educational sandbox. Past performance ≠ future results.`}
        </div>
      </div>
    </div>
  )
}
