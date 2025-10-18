# AI Trade Pilot (Netlify)

**Educational demo — not financial advice.**  
Predicts **direction & position sizing** for **stocks and forex**, using on-the-fly **logistic regression** trained from recent technical features (returns, SMA ratios, MACD, RSI).

## One‑click Deploy (Netlify)
1. Create a new repo from this folder.
2. On Netlify: **New site from Git** → connect repo.
3. Set build command: `npm run build`, publish dir: `dist`, functions dir: `functions`.
4. Add environment variable: **ALPHA_VANTAGE_KEY** (free key from alphavantage.co).
5. Deploy. Visit `/` to use the app.

## Local Dev
```bash
npm i
npm run dev
# open http://localhost:5173
```
Netlify functions locally:
```bash
npm run functions
# or use Netlify CLI if installed: netlify dev
```

## How it works
- Frontend (Vite + React) sends requests to `GET /api/predict` (Netlify Function).
- Function fetches compact OHLCV data from Alpha Vantage:
  - Stocks: `TIME_SERIES_DAILY_ADJUSTED` (or 60m intraday)
  - Forex: `FX_DAILY` (or 60m intraday via `FX_INTRADAY` alternative if enabled on your plan)
- Features: 1‑bar return, 5‑bar return, SMA5/SMA20 ratio, MACD, normalized RSI.
- Model: small **logistic regression** fitted on the last N bars (default 180).
- Signal: **LONG** if P(up) ≥ 0.5 else **SHORT**. Confidence from |P−0.5|.
- Sizing: risk-based; stop ≈ 2× recent volatility; spread deducted from edge.
- Backtest: naive next-bar execution with stop and spread (in‑sample).

## Configuration
- Query params (UI already wires these):
  - `symbol`: e.g., `AAPL`, `EURUSD`, `USDZAR`
  - `marketType`: `stock` or `forex`
  - `interval`: `DAILY` (default) or `INTRADAY` (60m)
  - `spreadBps`: basis points (default 5)
  - `riskPct`: percent equity at risk per trade (default 1)
  - `lookback`: bars to train on (default 220)

## Disclaimers
- Demo only; **do not** use for live trading without thorough research.
- Add out‑of‑sample validation, walk‑forward testing, and transaction cost modeling.
- Many providers limit intraday/forex endpoints to paid tiers; handle 429s/retries.
