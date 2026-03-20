package marketdata

import "context"

type DailyPrice struct {
	TradingDate   string
	Open          float64
	High          float64
	Low           float64
	Close         float64
	AdjustedClose float64
	Volume        int64
	Source        string
}

type Provider interface {
	FetchDailyHistory(ctx context.Context, symbol string, days int) ([]DailyPrice, error)
}
