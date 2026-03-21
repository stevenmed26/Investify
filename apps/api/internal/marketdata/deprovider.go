package marketdata

import (
	"context"
	"fmt"
	"hash/fnv"
	"math"
	"time"
)

type DevProvider struct{}

func NewDevProvider() *DevProvider {
	return &DevProvider{}
}

func hashSeed(symbol string) float64 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(symbol))
	return float64(h.Sum32()%5000) / 100.0
}

func (p *DevProvider) FetchDailyHistory(ctx context.Context, symbol string, days int, apiKey string) ([]DailyPrice, error) {
	if days <= 0 {
		days = 180
	}

	_ = ctx
	_ = apiKey

	base := 100.0 + hashSeed(symbol)
	now := time.Now().UTC()
	prices := make([]DailyPrice, 0, days)

	for i := days - 1; i >= 0; i-- {
		date := now.AddDate(0, 0, -i)
		if date.Weekday() == time.Saturday || date.Weekday() == time.Sunday {
			continue
		}

		t := float64(days-i) / 12.0
		trend := float64(days-i) * 0.08
		seasonal := math.Sin(t) * 3.0
		noise := math.Cos(t*1.7) * 1.2

		closePrice := base + trend + seasonal + noise
		openPrice := closePrice - 0.8 + math.Sin(t*0.6)*0.4
		highPrice := math.Max(openPrice, closePrice) + 1.1
		lowPrice := math.Min(openPrice, closePrice) - 1.0
		adjClose := closePrice
		volume := int64(1_000_000 + (days-i)*1500)

		prices = append(prices, DailyPrice{
			TradingDate:   fmt.Sprintf("%04d-%02d-%02d", date.Year(), date.Month(), date.Day()),
			Open:          round2(openPrice),
			High:          round2(highPrice),
			Low:           round2(lowPrice),
			Close:         round2(closePrice),
			AdjustedClose: round2(adjClose),
			Volume:        volume,
			Source:        "dev-synthetic",
		})
	}

	return prices, nil
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
