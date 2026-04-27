package services

import (
	"testing"
	"time"
)

func TestCountTradingDaysAfter(t *testing.T) {
	tests := []struct {
		name   string
		latest string
		target string
		want   int
	}{
		{name: "same day", latest: "2026-04-27", target: "2026-04-27", want: 0},
		{name: "next weekday", latest: "2026-04-27", target: "2026-04-28", want: 1},
		{name: "skips weekend", latest: "2026-04-24", target: "2026-04-27", want: 1},
		{name: "multiple weekdays", latest: "2026-04-20", target: "2026-04-27", want: 5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := countTradingDaysAfter(mustDate(t, tt.latest), mustDate(t, tt.target))
			if got != tt.want {
				t.Fatalf("countTradingDaysAfter() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestExpectedLatestTradingDate(t *testing.T) {
	tests := []struct {
		name string
		now  string
		want string
	}{
		{name: "weekday", now: "2026-04-27", want: "2026-04-27"},
		{name: "saturday", now: "2026-05-02", want: "2026-05-01"},
		{name: "sunday", now: "2026-05-03", want: "2026-05-01"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := expectedLatestTradingDate(mustDate(t, tt.now))
			if got != mustDate(t, tt.want) {
				t.Fatalf("expectedLatestTradingDate() = %s, want %s", got.Format(time.DateOnly), tt.want)
			}
		})
	}
}

func mustDate(t *testing.T, value string) time.Time {
	t.Helper()

	parsed, err := time.ParseInLocation(time.DateOnly, value, time.UTC)
	if err != nil {
		t.Fatalf("parse date %q: %v", value, err)
	}
	return parsed
}
