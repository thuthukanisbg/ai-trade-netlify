# Strategy & Roadmap

## Current (v0.1)
- Indicators: SMA(5,20), MACD(12,26,9), RSI(14), short & medium returns
- Model: logistic regression trained on-the-fly per request
- Execution: next-bar close, 2×ATR-lite stop, configurable spread
- Sizing: risk-based position sizing from stop distance
- Backtest: in-sample toy to visualize edge

## Suggested Next Steps
1. **Data**: add multiple providers (Finnhub, Twelve Data). Add caching.
2. **Features**: add ATR(14), ADX(14), trend regimes, volume features.
3. **Targets**: directional + magnitude; consider classification + regression.
4. **Models**: gradient boosting / random forest (on server), LSTM/TCN (server).
5. **Validation**: walk-forward, cross-validation, purged K-fold to avoid leakage.
6. **Risk**: Kelly fraction cap, portfolio risk constraints, max DD guardrails.
7. **Live Ops**: webhook alerts, paper trading integration (Alpaca, Oanda demo).
8. **UX**: multi-symbol dashboard, compare strategies, sharable permalinks.

> **Reminder:** Past performance is not indicative of future results.
