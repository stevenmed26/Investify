package models

type HealthResponse struct {
	Status string `json:"status"`
}

type Ticker struct {
	ID          string `json:"id"`
	Symbol      string `json:"symbol"`
	CompanyName string `json:"company_name"`
	Exchange    string `json:"exchange"`
	IsActive    bool   `json:"is_active"`
}

type Holding struct {
	ID               string   `json:"id"`
	UserID           string   `json:"user_id"`
	TickerID         string   `json:"ticker_id"`
	Symbol           string   `json:"symbol,omitempty"`
	CompanyName      string   `json:"company_name,omitempty"`
	SharesOwned      float64  `json:"shares_owned"`
	AverageCostBasis *float64 `json:"average_cost_basis,omitempty"`
}

type CreateHoldingRequest struct {
	UserID           string   `json:"user_id"`
	TickerID         string   `json:"ticker_id"`
	SharesOwned      float64  `json:"shares_owned"`
	AverageCostBasis *float64 `json:"average_cost_basis"`
}

type CreateHoldingBySymbolRequest struct {
	UserID           string   `json:"user_id"`
	Symbol           string   `json:"symbol"`
	SharesOwned      float64  `json:"shares_owned"`
	AverageCostBasis *float64 `json:"average_cost_basis"`
}

type PredictionRequest struct {
	Symbol      string `json:"symbol"`
	HorizonDays int    `json:"horizon_days"`
}

type PredictionResponse struct {
	Symbol             string         `json:"symbol"`
	PredictedDirection string         `json:"predicted_direction"`
	PredictedReturnPct float64        `json:"predicted_return_pct"`
	ConfidenceScore    float64        `json:"confidence_score"`
	Recommendation     string         `json:"recommendation"`
	Explanation        map[string]any `json:"explanation"`
	ModelVersion       string         `json:"model_version"`
}

type HistoricalPrice struct {
	ID            string  `json:"id,omitempty"`
	TickerID      string  `json:"ticker_id,omitempty"`
	TradingDate   string  `json:"trading_date"`
	Open          float64 `json:"open"`
	High          float64 `json:"high"`
	Low           float64 `json:"low"`
	Close         float64 `json:"close"`
	AdjustedClose float64 `json:"adjusted_close"`
	Volume        int64   `json:"volume"`
	Source        string  `json:"source"`
}
