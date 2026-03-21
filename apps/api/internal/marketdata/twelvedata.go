package marketdata

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type TwelveDataProvider struct {
	BaseURL string
	Client  *http.Client
}

func NewTwelveDataProvider(baseURL string) *TwelveDataProvider {
	baseURL = strings.TrimRight(baseURL, "/")
	if baseURL == "" {
		baseURL = "https://api.twelvedata.com"
	}

	return &TwelveDataProvider{
		BaseURL: baseURL,
		Client: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

type twelveDataResponse struct {
	Meta struct {
		Symbol   string `json:"symbol"`
		Interval string `json:"interval"`
	} `json:"meta"`
	Values []struct {
		Datetime string `json:"datetime"`
		Open     string `json:"open"`
		High     string `json:"high"`
		Low      string `json:"low"`
		Close    string `json:"close"`
		Volume   string `json:"volume"`
	} `json:"values"`
	Status  string `json:"status"`
	Message string `json:"message"`
	Code    int    `json:"code"`
}

func (p *TwelveDataProvider) FetchDailyHistory(ctx context.Context, symbol string, days int, apiKey string) ([]DailyPrice, error) {
	log.Printf("[marketdata] TwelveData FetchDailyHistory symbol=%s days=%d", symbol, days)

	if apiKey == "" {
		return nil, fmt.Errorf("missing Twelve Data API key")
	}

	u, _ := url.Parse(p.BaseURL + "/time_series")

	q := u.Query()
	q.Set("symbol", symbol)
	q.Set("interval", "1day")
	q.Set("outputsize", strconv.Itoa(days))
	q.Set("apikey", apiKey)
	u.RawQuery = q.Encode()

	log.Printf("[marketdata] TwelveData request symbol=%s days=%d", symbol, days)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}

	resp, err := p.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var apiResp twelveDataResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, err
	}

	if apiResp.Status == "error" {
		return nil, fmt.Errorf("twelvedata error: code=%d message=%s", apiResp.Code, apiResp.Message)
	}

	prices := make([]DailyPrice, 0, len(apiResp.Values))

	for i := len(apiResp.Values) - 1; i >= 0; i-- {
		v := apiResp.Values[i]

		open, err := strconv.ParseFloat(v.Open, 64)
		if err != nil {
			return nil, fmt.Errorf("parse open %q: %w", v.Open, err)
		}
		high, err := strconv.ParseFloat(v.High, 64)
		if err != nil {
			return nil, fmt.Errorf("parse high %q: %w", v.High, err)
		}
		low, err := strconv.ParseFloat(v.Low, 64)
		if err != nil {
			return nil, fmt.Errorf("parse low %q: %w", v.Low, err)
		}
		closep, err := strconv.ParseFloat(v.Close, 64)
		if err != nil {
			return nil, fmt.Errorf("parse close %q: %w", v.Close, err)
		}

		var volume int64
		if v.Volume != "" {
			volume, err = strconv.ParseInt(v.Volume, 10, 64)
			if err != nil {
				return nil, fmt.Errorf("parse volume %q: %w", v.Volume, err)
			}
		}

		prices = append(prices, DailyPrice{
			TradingDate:   v.Datetime,
			Open:          open,
			High:          high,
			Low:           low,
			Close:         closep,
			AdjustedClose: closep,
			Volume:        volume,
			Source:        "twelvedata",
		})
	}

	log.Printf("[marketdata] TwelveData fetched rows=%d symbol=%s", len(prices), symbol)

	return prices, nil
}
