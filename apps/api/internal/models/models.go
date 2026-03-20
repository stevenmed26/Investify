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
