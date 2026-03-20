package services

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type FeatureEngineeringService struct {
	DB *pgxpool.Pool
}

type pricePoint struct {
	TradingDate string
	Close       float64
}

type computedFeatureRow struct {
	TradingDate   string
	SMA20         *float64
	SMA50         *float64
	EMA12         *float64
	EMA26         *float64
	RSI14         *float64
	MACD          *float64
	Momentum5D    *float64
	Momentum20D   *float64
	Volatility20D *float64
}

func (s *FeatureEngineeringService) BackfillBySymbol(ctx context.Context, symbol string) (int, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return 0, fmt.Errorf("symbol is required")
	}

	var tickerID string
	err := s.DB.QueryRow(ctx, `
		SELECT id
		FROM tickers
		WHERE symbol = $1
	`, symbol).Scan(&tickerID)
	if err != nil {
		return 0, fmt.Errorf("ticker not found: %w", err)
	}

	rows, err := s.DB.Query(ctx, `
		SELECT trading_date, COALESCE(adjusted_close, close) AS close_price
		FROM historical_prices
		WHERE ticker_id = $1
		ORDER BY trading_date ASC
	`, tickerID)
	if err != nil {
		return 0, fmt.Errorf("fetch historical prices: %w", err)
	}
	defer rows.Close()

	prices := make([]pricePoint, 0)
	for rows.Next() {
		var p pricePoint
		if err := rows.Scan(&p.TradingDate, &p.Close); err != nil {
			return 0, fmt.Errorf("scan price row: %w", err)
		}
		prices = append(prices, p)
	}

	if len(prices) == 0 {
		return 0, fmt.Errorf("no historical prices found")
	}

	features := computeFeatureRows(prices)

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	count := 0
	for _, f := range features {
		_, err := tx.Exec(ctx, `
			INSERT INTO technical_features (
				ticker_id,
				trading_date,
				sma_20,
				sma_50,
				ema_12,
				ema_26,
				rsi_14,
				macd,
				momentum_5d,
				momentum_20d,
				volatility_20d,
				created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			ON CONFLICT (ticker_id, trading_date)
			DO UPDATE SET
				sma_20 = EXCLUDED.sma_20,
				sma_50 = EXCLUDED.sma_50,
				ema_12 = EXCLUDED.ema_12,
				ema_26 = EXCLUDED.ema_26,
				rsi_14 = EXCLUDED.rsi_14,
				macd = EXCLUDED.macd,
				momentum_5d = EXCLUDED.momentum_5d,
				momentum_20d = EXCLUDED.momentum_20d,
				volatility_20d = EXCLUDED.volatility_20d
		`,
			tickerID,
			f.TradingDate,
			f.SMA20,
			f.SMA50,
			f.EMA12,
			f.EMA26,
			f.RSI14,
			f.MACD,
			f.Momentum5D,
			f.Momentum20D,
			f.Volatility20D,
			time.Now().UTC(),
		)
		if err != nil {
			return 0, fmt.Errorf("upsert technical feature: %w", err)
		}
		count++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit tx: %w", err)
	}

	return count, nil
}

func computeFeatureRows(prices []pricePoint) []computedFeatureRow {
	n := len(prices)
	closes := make([]float64, n)
	for i, p := range prices {
		closes[i] = p.Close
	}

	sma20 := simpleMovingAverageSeries(closes, 20)
	sma50 := simpleMovingAverageSeries(closes, 50)
	ema12 := exponentialMovingAverageSeries(closes, 12)
	ema26 := exponentialMovingAverageSeries(closes, 26)
	rsi14 := rsiSeries(closes, 14)
	momentum5 := momentumSeries(closes, 5)
	momentum20 := momentumSeries(closes, 20)
	vol20 := volatilitySeries(closes, 20)

	out := make([]computedFeatureRow, 0, n)
	for i, p := range prices {
		var macd *float64
		if ema12[i] != nil && ema26[i] != nil {
			value := round4(*ema12[i] - *ema26[i])
			macd = &value
		}

		out = append(out, computedFeatureRow{
			TradingDate:   p.TradingDate,
			SMA20:         sma20[i],
			SMA50:         sma50[i],
			EMA12:         ema12[i],
			EMA26:         ema26[i],
			RSI14:         rsi14[i],
			MACD:          macd,
			Momentum5D:    momentum5[i],
			Momentum20D:   momentum20[i],
			Volatility20D: vol20[i],
		})
	}

	return out
}

func simpleMovingAverageSeries(values []float64, period int) []*float64 {
	out := make([]*float64, len(values))
	if period <= 0 {
		return out
	}

	sum := 0.0
	for i := range values {
		sum += values[i]
		if i >= period {
			sum -= values[i-period]
		}
		if i >= period-1 {
			value := round4(sum / float64(period))
			out[i] = &value
		}
	}
	return out
}

func exponentialMovingAverageSeries(values []float64, period int) []*float64 {
	out := make([]*float64, len(values))
	if len(values) == 0 || period <= 0 || len(values) < period {
		return out
	}

	k := 2.0 / float64(period+1)

	sum := 0.0
	for i := 0; i < period; i++ {
		sum += values[i]
	}
	initial := sum / float64(period)
	initial = round4(initial)
	out[period-1] = &initial

	prev := initial
	for i := period; i < len(values); i++ {
		ema := values[i]*k + prev*(1.0-k)
		ema = round4(ema)
		out[i] = &ema
		prev = ema
	}

	return out
}

func momentumSeries(values []float64, lookback int) []*float64 {
	out := make([]*float64, len(values))
	if lookback <= 0 {
		return out
	}

	for i := range values {
		if i < lookback {
			continue
		}
		if values[i-lookback] == 0 {
			continue
		}
		value := ((values[i] / values[i-lookback]) - 1.0) * 100.0
		value = round4(value)
		out[i] = &value
	}

	return out
}

func volatilitySeries(values []float64, window int) []*float64 {
	out := make([]*float64, len(values))
	if window <= 1 || len(values) < 2 {
		return out
	}

	returns := make([]float64, len(values))
	for i := 1; i < len(values); i++ {
		if values[i-1] == 0 {
			continue
		}
		returns[i] = math.Log(values[i] / values[i-1])
	}

	for i := range values {
		if i < window {
			continue
		}
		start := i - window + 1
		segment := returns[start : i+1]
		std := sampleStdDev(segment)
		value := round4(std * math.Sqrt(252) * 100.0)
		out[i] = &value
	}

	return out
}

func rsiSeries(values []float64, period int) []*float64 {
	out := make([]*float64, len(values))
	if len(values) <= period || period <= 0 {
		return out
	}

	gains := make([]float64, len(values))
	losses := make([]float64, len(values))
	for i := 1; i < len(values); i++ {
		diff := values[i] - values[i-1]
		if diff > 0 {
			gains[i] = diff
		} else {
			losses[i] = -diff
		}
	}

	avgGain := 0.0
	avgLoss := 0.0
	for i := 1; i <= period; i++ {
		avgGain += gains[i]
		avgLoss += losses[i]
	}
	avgGain /= float64(period)
	avgLoss /= float64(period)

	if avgLoss == 0 {
		value := 100.0
		value = round4(value)
		out[period] = &value
	} else {
		rs := avgGain / avgLoss
		value := 100.0 - (100.0 / (1.0 + rs))
		value = round4(value)
		out[period] = &value
	}

	for i := period + 1; i < len(values); i++ {
		avgGain = ((avgGain * float64(period-1)) + gains[i]) / float64(period)
		avgLoss = ((avgLoss * float64(period-1)) + losses[i]) / float64(period)

		var value float64
		if avgLoss == 0 {
			value = 100.0
		} else {
			rs := avgGain / avgLoss
			value = 100.0 - (100.0 / (1.0 + rs))
		}
		value = round4(value)
		out[i] = &value
	}

	return out
}

func sampleStdDev(values []float64) float64 {
	n := len(values)
	if n <= 1 {
		return 0
	}

	mean := 0.0
	for _, v := range values {
		mean += v
	}
	mean /= float64(n)

	variance := 0.0
	for _, v := range values {
		diff := v - mean
		variance += diff * diff
	}
	variance /= float64(n - 1)

	return math.Sqrt(variance)
}

func round4(v float64) float64 {
	return math.Round(v*10000) / 10000
}
