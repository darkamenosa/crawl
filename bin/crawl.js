#!/usr/bin/env node

const { PlaywrightCrawler, log, LogLevel, sleep } = require('crawlee');
const { BrowserName, DeviceCategory, OperatingSystemsName } = require('@crawlee/browser-pool');
const { firefox } = require('playwright');
const { URL } = require('url');
const { version: packageVersion, name: packageName } = require('../package.json');

log.setLevel(LogLevel.ERROR);

const EXIT_INVALID_ARGUMENT = 2;

function handleMetaCommands(args) {
    const [command] = args;

    if (['--version', '-v', 'version'].includes(command)) {
        printVersion();
        return true;
    }

    if (['--help', '-h', 'help'].includes(command)) {
        printUsage(console.log);
        return true;
    }

    return false;
}

function parseArguments(args) {
    const url = args[0];
    if (!isValidUrl(url)) {
        console.error('Error: First argument must be a valid URL.');
        printUsage(console.error);
        process.exit(EXIT_INVALID_ARGUMENT);
    }

    const options = {
        // Prefer the new env var name but keep the legacy one as fallback for backwards compatibility
        proxyUrl: process.env.CRAWL_PROXY_URL ?? process.env.CRAWLER_PROXY_URL,
    };

    for (let i = 1; i < args.length; i += 1) {
        const arg = args[i];
        if ((arg === '--proxy' || arg === '-p') && args[i + 1]) {
            const proxyCandidate = args[i + 1];
            if (!isValidProxyUrl(proxyCandidate)) {
                console.error('Error: --proxy must be a valid HTTP/HTTPS/SOCKS5 URL.');
                process.exit(EXIT_INVALID_ARGUMENT);
            }
            options.proxyUrl = proxyCandidate;
            i += 1;
        } else if (arg === '--headful') {
            options.headless = false;
        } else if (arg === '--timeout' && args[i + 1]) {
            const timeout = Number(args[i + 1]);
            if (Number.isNaN(timeout) || timeout <= 0) {
                console.error('Error: --timeout must be a positive number of seconds.');
                process.exit(EXIT_INVALID_ARGUMENT);
            }
            options.timeoutSecs = timeout;
            i += 1;
        } else {
            console.error(`Error: Unknown option ${arg}`);
            printUsage(console.error);
            process.exit(EXIT_INVALID_ARGUMENT);
        }
    }

    return { url, options };
}

function printUsage(logger = console.log) {
    logger('Usage: crawl <url> [--proxy <url>] [--timeout <seconds>] [--headful]');
    logger('Options:');
    logger('  --proxy, -p       Override proxy (falls back to CRAWL_PROXY_URL, legacy CRAWLER_PROXY_URL)');
    logger('  --timeout         Navigation timeout in seconds (default 60)');
    logger('  --headful         Launch browser with UI visible');
    logger('  --help, -h        Show this help message');
    logger('  --version, -v     Print CLI version');
}

function printVersion() {
    const name = packageName || 'crawl';
    console.log(`${name} v${packageVersion}`);
}

function isValidUrl(candidate) {
    try {
        const parsed = new URL(candidate);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
        return false;
    }
}

function isValidProxyUrl(candidate) {
    try {
        const parsed = new URL(candidate);
        return ['http:', 'https:', 'socks5:'].includes(parsed.protocol);
    } catch (error) {
        return false;
    }
}

function createLaunchOptions(cliOptions) {
    const launchOptions = {
        headless: cliOptions.headless !== false,
        ignoreHTTPSErrors: true,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-gpu',
        ],
    };

    if (cliOptions.proxyUrl) {
        const proxy = new URL(cliOptions.proxyUrl);
        launchOptions.proxy = {
            server: `${proxy.protocol}//${proxy.hostname}${proxy.port ? `:${proxy.port}` : ''}`,
        };

        if (proxy.username) {
            launchOptions.proxy.username = decodeURIComponent(proxy.username);
        }

        if (proxy.password) {
            launchOptions.proxy.password = decodeURIComponent(proxy.password);
        }
    }

    return launchOptions;
}

async function fetchHtml(url, cliOptions) {
    let html = '';

    const crawlerInstance = new PlaywrightCrawler({
        requestHandlerTimeoutSecs: cliOptions.timeoutSecs ?? 60,
        maxConcurrency: 2,
        maxRequestsPerCrawl: 1,
        useSessionPool: true,
        sessionPoolOptions: {
            maxPoolSize: 4,
            sessionOptions: {
                maxErrorScore: 0.5,
                maxUsageCount: 5,
            },
        },
        launchContext: {
            launcher: firefox,
            launchOptions: createLaunchOptions(cliOptions),
        },
        browserPoolOptions: {
            useFingerprints: true,
            fingerprintOptions: {
                fingerprintGeneratorOptions: {
                    browsers: [
                        {
                            name: BrowserName.firefox,
                            minVersion: 120,
                        },
                    ],
                    devices: [DeviceCategory.desktop],
                    operatingSystems: [OperatingSystemsName.windows],
                    locales: ['en-US'],
                },
            },
        },
        navigationTimeoutSecs: cliOptions.timeoutSecs ?? 60,
        preNavigationHooks: [
            async ({ page }, gotoOptions) => {
                await page.route('**/*', (route) => {
                    const resourceType = route.request().resourceType();
                    if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                        return route.abort();
                    }
                    return route.continue();
                });

                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'en-US,en;q=0.9',
                    'DNT': '1',
                });

                // jitter navigation timing to mimic human behavior
                const jitter = Math.random() * 750 + 250;
                await sleep(jitter);

                if (gotoOptions) {
                    gotoOptions.waitUntil = gotoOptions.waitUntil ?? 'domcontentloaded';
                }
            },
        ],
        postNavigationHooks: [
            async ({ page, handleCloudflareChallenge }) => {
                if (typeof handleCloudflareChallenge === 'function') {
                    await handleCloudflareChallenge().catch(() => {});
                }

                // small idle wait gives JS-heavy pages time to settle
                await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
                await sleep(Math.random() * 600 + 400);
            },
        ],
        requestHandler: async ({ page, session, response }) => {
            const status = response?.status();
            if (status && status >= 400) {
                if (session) {
                    session.markBad();
                }
                throw new Error(`Blocked with status code ${status}`);
            }

            html = await page.content();
            if (session) {
                session.markGood();
            }
        },
        failedRequestHandler: async ({ request }) => {
            console.error(`Failed to load ${request.url}`);
        },
    });

    await crawlerInstance.run([{ url }]);
    await crawlerInstance.teardown();

    return html;
}

(async () => {
    try {
        const args = process.argv.slice(2);

        if (args.length === 0) {
            printUsage(console.error);
            process.exit(EXIT_INVALID_ARGUMENT);
            return;
        }

        if (handleMetaCommands(args)) {
            return;
        }

        const { url, options } = parseArguments(args);
        const html = await fetchHtml(url, options);
        if (!html) {
            process.exitCode = 1;
            return;
        }
        process.stdout.write(html);
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 1;
    }
})();
