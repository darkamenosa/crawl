# Crawl CLI

A small command-line helper that navigates to a page with Playwright + Crawlee + Camoufox, captures the fully rendered HTML, and prints it to `stdout`. Pair it with your own Markdown/AI tooling to unblock content that requires an on-page browser fetch before post-processing.

## Features
- Launches Camoufox-patched Firefox for stronger anti-bot fingerprints.
- Blocks heavy assets (images, fonts, media) to keep responses fast and light.
- Handles Cloudflare-style interstitials and marks bad sessions for retry.
- Outputs the final DOM HTML so you can pipe it directly into downstream tools.
- Caches HTML responses locally so repeat crawls of the same URL return instantly.

## Installation
1. Ensure Node.js 18+ is available (`node -v`).
2. Install dependencies:
   ```sh
   npm install
   ```
   Installs trigger a postinstall hook that downloads the Camoufox browser bundle (equivalent to `npx camoufox-js fetch`). Set `SKIP_CAMOUFOX_FETCH=1` if you prefer to run it manually later.
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

### Manually fetching Camoufox
The postinstall script runs `npx camoufox-js fetch` automatically. To run it yourself (for CI images or when `SKIP_CAMOUFOX_FETCH=1`), execute:

```sh
npx camoufox-js fetch
```

Once fetched, the Camoufox Firefox build is stored inside your Node global prefix (for asdf: `~/.asdf/installs/nodejs/<version>/lib/node_modules/crawl`).

## Usage
```sh
crawl <url> [--proxy <url>] [--timeout <seconds>] [--headful] [--no-cache] [--clear-cache]
```

### Options
- `--proxy`, `-p`: Override the proxy URL. You can also set `CRAWL_PROXY_URL` (or legacy `CRAWLER_PROXY_URL`). Supports HTTP/HTTPS/SOCKS5.
- `--timeout`: Navigation timeout in seconds (default `60`). Applies to both navigation and request handler.
- `--headful`: Launch Firefox with the UI visible instead of headless.
- `--no-cache`: Skip reading/writing the local `.cache` directory so the run always hits the network.
- `--clear-cache`: Delete the `.cache` directory before starting the crawl. When provided alone (`crawl --clear-cache`) it just clears the cache and exits.
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
- Uses `PlaywrightCrawler` with Camoufox Firefox to mimic desktop users (`en-US` locale, Windows fingerprint).
- Waits for `networkidle` and adds jitter to navigation to reduce bot detection.
- Blocks large asset types to keep responses light while preserving the DOM structure.
- Stores the final HTML at `.cache/<sha256(url)>.html` so subsequent runs can return instantly without launching a browser (unless `--no-cache` is passed).
- Marks successful sessions as good so retries stay fast; propagates HTTP 4xx/5xx as failures.

## Cache Location

The cache directory defaults to `.cache` relative to where the CLI lives. When you run the script from the repo (`node bin/crawl.js`), cached files land in `<repo>/.cache`. If you run it via `npm link`, they live beside the globally linked package (for asdf users that is `~/.asdf/installs/nodejs/<version>/lib/node_modules/crawl/.cache`). Delete the folder manually or use `crawl --clear-cache` to purge it.

## Troubleshooting
- **Blocked with status code…**: The target site rejected the request. Provide a different proxy or run headful to debug.
- **Browser download required**: Run `npx playwright install firefox` to fetch the browser bundle.
- **No output**: Check the exit code. Non-zero status means the crawl failed; logs are printed to `stderr`.
- **Camoufox fetch skipped**: Ensure the postinstall hook runs or call `npx camoufox-js fetch` manually.

## License
ISC
