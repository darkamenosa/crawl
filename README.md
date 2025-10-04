# Crawl CLI

A small command-line helper that navigates to a page with Playwright + Crawlee, captures the fully rendered HTML, and prints it to `stdout`. Pair it with your own Markdown/AI tooling to unblock content that requires an on-page browser fetch before post-processing.

## Features
- Launches a fingerprinted Firefox session with sensible anti-bot defaults.
- Blocks heavy assets (images, fonts, media) to keep responses fast and light.
- Handles Cloudflare-style interstitials and marks bad sessions for retry.
- Outputs the final DOM HTML so you can pipe it directly into downstream tools.

## Installation
1. Ensure Node.js 18+ is available (`node -v`).
2. Install dependencies:
   ```sh
   npm install
   ```
3. (Optional) Install Playwright browsers if this is your first run:
   ```sh
   npx playwright install firefox
   ```
4. (Optional) Link the CLI globally while developing:
   ```sh
   npm link
   ```
   Afterwards you can invoke it as `crawl` from anywhere in your shell.

If you prefer not to link globally, run it in-place with `node bin/crawl.js …` or `npx crawl …` from the project root.

## Usage
```sh
crawl <url> [--proxy <url>] [--timeout <seconds>] [--headful]
```

### Options
- `--proxy`, `-p`: Override the proxy URL. You can also set `CRAWL_PROXY_URL` (or legacy `CRAWLER_PROXY_URL`). Supports HTTP/HTTPS/SOCKS5.
- `--timeout`: Navigation timeout in seconds (default `60`). Applies to both navigation and request handler.
- `--headful`: Launch Firefox with the UI visible instead of headless.
- `--help`, `-h`: Print the usage guide.
- `--version`, `-v`: Show the CLI version.

### Example flows
Collect HTML for further Markdown parsing:
```sh
crawl https://example.com | markdown-cli > out.md
```

Run with an authenticated proxy and longer timeout:
```sh
CRAWL_PROXY_URL="http://user:pass@proxy.example:8080" \
  crawl https://blocked.example --timeout 120 > page.html
```

Open a visible browser for tuning selectors:
```sh
crawl https://example.com --headful > /dev/null
```

## How It Works
- Uses `PlaywrightCrawler` with Firefox to mimic desktop users (`en-US` locale, Windows fingerprint).
- Waits for `networkidle` and adds jitter to navigation to reduce bot detection.
- Blocks large asset types to keep responses light while preserving the DOM structure.
- Marks successful sessions as good so retries stay fast; propagates HTTP 4xx/5xx as failures.

## Troubleshooting
- **Blocked with status code…**: The target site rejected the request. Provide a different proxy or run headful to debug.
- **Browser download required**: Run `npx playwright install firefox` to fetch the browser bundle.
- **No output**: Check the exit code. Non-zero status means the crawl failed; logs are printed to `stderr`.

## License
ISC
