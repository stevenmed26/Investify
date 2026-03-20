package mlclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"investify/apps/api/internal/models"
)

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

func New(baseURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *Client) Predict(ctx context.Context, symbol string, horizonDays int) (*models.PredictionResponse, error) {
	if horizonDays <= 0 {
		horizonDays = 5
	}

	payload := models.PredictionRequest{
		Symbol:      symbol,
		HorizonDays: horizonDays,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal predict payload: %w", err)
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.BaseURL+"/predict",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create predict request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call ml service: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ml service returned status %d", res.StatusCode)
	}

	var out models.PredictionResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode predict response: %w", err)
	}

	return &out, nil
}
