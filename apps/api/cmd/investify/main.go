package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const defaultAPIURL = "http://localhost:8080"

type cli struct {
	baseURL    string
	email      string
	password   string
	localToken string
	client     *http.Client
	cookie     *http.Cookie
}

func main() {
	c := &cli{
		baseURL:    envDefault("INVESTIFY_API_URL", defaultAPIURL),
		email:      envDefault("INVESTIFY_OPERATOR_EMAIL", envDefault("INVESTIFY_ADMIN_EMAIL", "admin@investify.com")),
		password:   os.Getenv("INVESTIFY_ADMIN_PASSWORD"),
		localToken: os.Getenv("INVESTIFY_LOCAL_TOKEN"),
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	if err := c.run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func (c *cli) run(args []string) error {
	if len(args) == 0 {
		usage()
		return nil
	}

	switch args[0] {
	case "login":
		fs := c.flagSet("login")
		c.bindAuthFlags(fs)
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if err := c.login(); err != nil {
			return err
		}
		fmt.Println("login ok")
		return nil
	case "pipeline":
		return c.pipeline(args[1:])
	case "jobs":
		return c.jobs(args[1:])
	case "ingest":
		return c.ingest(args[1:])
	case "features":
		return c.features(args[1:])
	case "help", "-h", "--help":
		usage()
		return nil
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func (c *cli) pipeline(args []string) error {
	if len(args) == 0 {
		return errors.New("pipeline requires a subcommand")
	}
	switch args[0] {
	case "run":
		fs := c.flagSet("pipeline run")
		c.bindAuthFlags(fs)
		days := fs.Int("days", 365, "history window in days")
		delayMS := fs.Int("delay-ms", 7500, "delay between market data calls")
		horizonDays := fs.Int("horizon", 5, "training horizon in days")
		symbols := fs.String("symbols", "", "optional comma-separated ticker symbols")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		values := url.Values{}
		values.Set("days", fmt.Sprint(*days))
		values.Set("delay_ms", fmt.Sprint(*delayMS))
		values.Set("horizon_days", fmt.Sprint(*horizonDays))
		if strings.TrimSpace(*symbols) != "" {
			values.Set("symbols", *symbols)
		}
		return c.authedRequest(http.MethodPost, "/api/v1/admin/pipeline/daily?"+values.Encode(), nil)
	default:
		return fmt.Errorf("unknown pipeline subcommand %q", args[0])
	}
}

func (c *cli) jobs(args []string) error {
	if len(args) == 0 {
		return errors.New("jobs requires a subcommand")
	}
	switch args[0] {
	case "list":
		fs := c.flagSet("jobs list")
		c.bindAuthFlags(fs)
		service := fs.String("service", "", "optional service filter")
		status := fs.String("status", "", "optional status filter")
		limit := fs.Int("limit", 20, "maximum jobs to return")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		values := url.Values{}
		values.Set("limit", fmt.Sprint(*limit))
		if strings.TrimSpace(*service) != "" {
			values.Set("service", *service)
		}
		if strings.TrimSpace(*status) != "" {
			values.Set("status", *status)
		}
		return c.authedRequest(http.MethodGet, "/api/v1/admin/jobs?"+values.Encode(), nil)
	case "get":
		fs := c.flagSet("jobs get")
		c.bindAuthFlags(fs)
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if fs.NArg() != 1 {
			return errors.New("jobs get requires a job id")
		}
		return c.authedRequest(http.MethodGet, "/api/v1/admin/jobs/"+url.PathEscape(fs.Arg(0)), nil)
	default:
		return fmt.Errorf("unknown jobs subcommand %q", args[0])
	}
}

func (c *cli) ingest(args []string) error {
	fs := c.flagSet("ingest")
	c.bindAuthFlags(fs)
	days := fs.Int("days", 365, "history window in days")
	delayMS := fs.Int("delay-ms", 9000, "delay between market data calls")
	symbols := fs.String("symbols", "", "comma-separated ticker symbols; omit for all active tickers")
	if err := fs.Parse(args); err != nil {
		return err
	}

	values := url.Values{}
	values.Set("days", fmt.Sprint(*days))
	values.Set("delay_ms", fmt.Sprint(*delayMS))
	body := symbolsBody(*symbols)
	return c.authedRequest(http.MethodPost, "/api/v1/admin/ingest/batch/history?"+values.Encode(), body)
}

func (c *cli) features(args []string) error {
	if len(args) == 0 {
		return errors.New("features requires a subcommand")
	}
	switch args[0] {
	case "backfill":
		fs := c.flagSet("features backfill")
		c.bindAuthFlags(fs)
		symbols := fs.String("symbols", "", "comma-separated ticker symbols; omit for all active tickers")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		body := symbolsBody(*symbols)
		return c.authedRequest(http.MethodPost, "/api/v1/admin/features/batch/backfill", body)
	default:
		return fmt.Errorf("unknown features subcommand %q", args[0])
	}
}

func (c *cli) bindAuthFlags(fs *flag.FlagSet) {
	fs.StringVar(&c.baseURL, "api-url", c.baseURL, "Investify API base URL")
	fs.StringVar(&c.email, "email", c.email, "operator email")
	fs.StringVar(&c.password, "password", c.password, "operator password")
	fs.StringVar(&c.localToken, "local-token", c.localToken, "local operator token")
}

func (c *cli) authedRequest(method, path string, body []byte) error {
	if err := c.ensureAuth(); err != nil {
		return err
	}

	req, err := http.NewRequest(method, strings.TrimRight(c.baseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.localToken != "" {
		req.Header.Set("X-Local-Token", c.localToken)
	}
	if c.cookie != nil {
		req.AddCookie(c.cookie)
	}

	res, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	return printResponse(res)
}

func (c *cli) ensureAuth() error {
	if c.localToken != "" || c.password == "" {
		return nil
	}
	return c.login()
}

func (c *cli) login() error {
	if c.cookie != nil {
		return nil
	}
	if strings.TrimSpace(c.email) == "" {
		return errors.New("operator email is required")
	}
	if c.password == "" {
		return errors.New("operator password is required via --password or INVESTIFY_ADMIN_PASSWORD")
	}

	payload, err := json.Marshal(map[string]string{
		"email":    c.email,
		"password": c.password,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(c.baseURL, "/")+"/api/v1/auth/login", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		return fmt.Errorf("login failed: status=%d body=%s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	for _, cookie := range res.Cookies() {
		if cookie.Name != "" && cookie.Value != "" {
			c.cookie = cookie
			return nil
		}
	}
	return errors.New("login did not return a session cookie")
}

func (c *cli) flagSet(name string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	return fs
}

func printResponse(res *http.Response) error {
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("request failed: status=%d body=%s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	var pretty bytes.Buffer
	if json.Indent(&pretty, body, "", "  ") == nil {
		fmt.Println(pretty.String())
		return nil
	}
	fmt.Println(strings.TrimSpace(string(body)))
	return nil
}

func symbolsBody(raw string) []byte {
	symbols := splitCSV(raw)
	if len(symbols) == 0 {
		return nil
	}
	body, _ := json.Marshal(map[string][]string{"symbols": symbols})
	return body
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		value := strings.ToUpper(strings.TrimSpace(part))
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func envDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func usage() {
	fmt.Println(`investify local CLI

Usage:
  investify login [--api-url URL] [--email EMAIL] [--password PASSWORD]
  investify pipeline run [--days 365] [--delay-ms 7500] [--horizon 5] [--symbols AAPL,MSFT]
  investify jobs list [--status queued|running|completed|failed] [--limit 20]
  investify jobs get <job-id>
  investify ingest [--symbols AAPL,MSFT] [--days 365] [--delay-ms 9000]
  investify features backfill [--symbols AAPL,MSFT]

Environment:
  INVESTIFY_API_URL          default http://localhost:8080
  INVESTIFY_OPERATOR_EMAIL   operator email for password auth mode
  INVESTIFY_ADMIN_EMAIL      legacy alias for INVESTIFY_OPERATOR_EMAIL
  INVESTIFY_ADMIN_PASSWORD   used only for password auth mode
  INVESTIFY_LOCAL_TOKEN      preferred for local auth mode`)
}
