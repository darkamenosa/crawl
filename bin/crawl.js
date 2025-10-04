#!/usr/bin/env node

const { PlaywrightCrawler, Configuration, log, LogLevel, sleep } = require('crawlee');
const { chromium, firefox } = require('playwright');
const { URL } = require('url');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { version: packageVersion, name: packageName } = require('../package.json');
const { launchOptions: camoufoxLaunchOptions } = require('camoufox-js');

log.setLevel(LogLevel.ERROR);

const EXIT_INVALID_ARGUMENT = 2;
const CACHE_DIR = path.resolve(__dirname, '..', '.cache');

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
    const options = {
        // Prefer the new env var name but keep the legacy one as fallback for backwards compatibility
        proxyUrl: process.env.CRAWL_PROXY_URL ?? process.env.CRAWLER_PROXY_URL,
        useCache: true,
        clearCache: false,
        useCamoufox: false,
    };

    let url;

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];

        if (!url && !arg.startsWith('-')) {
            if (!isValidUrl(arg)) {
                console.error('Error: First non-option argument must be a valid URL.');
                printUsage(console.error);
                process.exit(EXIT_INVALID_ARGUMENT);
            }
            url = arg;
            continue;
        }

        if ((arg === '--proxy' || arg === '-p') && args[i + 1]) {
            const proxyCandidate = args[i + 1];
            if (!isValidProxyUrl(proxyCandidate)) {
                console.error('Error: --proxy must be a valid HTTP/HTTPS/SOCKS5 URL.');
                process.exit(EXIT_INVALID_ARGUMENT);
            }
            options.proxyUrl = proxyCandidate;
            i += 1;
            continue;
        }

        if (arg === '--headful') {
            options.headless = false;
            continue;
        }

        if (arg === '--timeout' && args[i + 1]) {
            const timeout = Number(args[i + 1]);
            if (Number.isNaN(timeout) || timeout <= 0) {
                console.error('Error: --timeout must be a positive number of seconds.');
                process.exit(EXIT_INVALID_ARGUMENT);
            }
            options.timeoutSecs = timeout;
            i += 1;
            continue;
        }

        if (arg === '--no-cache') {
            options.useCache = false;
            continue;
        }

        if (arg === '--clear-cache') {
            options.clearCache = true;
            continue;
        }

        if (arg === '--camoufox') {
            options.useCamoufox = true;
            continue;
        }

        console.error(`Error: Unknown option ${arg}`);
        printUsage(console.error);
        process.exit(EXIT_INVALID_ARGUMENT);
    }

    if (!url) {
        console.error('Error: URL is required.');
        printUsage(console.error);
        process.exit(EXIT_INVALID_ARGUMENT);
    }

    return { url, options };
}

function printUsage(logger = console.log) {
    logger('Usage: crawl <url> [--proxy <url>] [--timeout <seconds>] [--headful] [--no-cache] [--clear-cache] [--camoufox]');
    logger('Options:');
    logger('  --proxy, -p       Override proxy (falls back to CRAWL_PROXY_URL, legacy CRAWLER_PROXY_URL)');
    logger('  --timeout         Navigation timeout in seconds (default 60)');
    logger('  --headful         Launch browser with UI visible');
    logger('  --no-cache        Skip reading/writing the local response cache (.cache directory)');
    logger('  --clear-cache     Remove the local .cache directory before crawling');
    logger('  --camoufox        Use Firefox with Camoufox hardening instead of the default Chrome setup');
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

async function createLaunchContext(cliOptions) {
    const headless = cliOptions.headless !== false;
    const baseArgs = [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-gpu',
    ];

    let proxy;
    if (cliOptions.proxyUrl) {
        const parsedProxy = new URL(cliOptions.proxyUrl);
        proxy = {
            server: `${parsedProxy.protocol}//${parsedProxy.hostname}${parsedProxy.port ? `:${parsedProxy.port}` : ''}`,
        };

        if (parsedProxy.username) {
            proxy.username = decodeURIComponent(parsedProxy.username);
        }

        if (parsedProxy.password) {
            proxy.password = decodeURIComponent(parsedProxy.password);
        }
    }

    if (cliOptions.useCamoufox) {
        const camoufoxOptions = await camoufoxLaunchOptions({
            headless,
            proxy,
        });

        const mergedArgs = [...new Set([...(camoufoxOptions.args ?? []), ...baseArgs])];

        const launchOptions = {
            ...camoufoxOptions,
            headless,
            ignoreHTTPSErrors: true,
            args: mergedArgs,
        };

        if (!launchOptions.proxy && proxy) {
            launchOptions.proxy = proxy;
        }

        return {
            launcher: firefox,
            launchOptions,
        };
    }

    const chromeLaunchOptions = {
        headless,
        ignoreHTTPSErrors: true,
        args: baseArgs,
    };

    if (proxy) {
        chromeLaunchOptions.proxy = proxy;
    }

    return {
        launcher: chromium,
        launchOptions: chromeLaunchOptions,
    };
}

async function fetchHtml(url, cliOptions) {
    let html = '';

    const cachedHtml = cliOptions.useCache ? await readFromCache(url) : null;
    if (cachedHtml != null) {
        return cachedHtml;
    }

    const launchContext = await createLaunchContext(cliOptions);

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
        launchContext,
        browserPoolOptions: {
            useFingerprints: false,
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
    }, new Configuration({
        persistStorage: false,
    }));

    try {
        await crawlerInstance.run([{ url }]);
    } finally {
        // Always tear down crawler resources to avoid dangling browser processes.
        await crawlerInstance.teardown().catch(() => {});
        if (crawlerInstance.browserPool?.closeAllBrowsers) {
            await crawlerInstance.browserPool.closeAllBrowsers(true).catch(() => {});
        }
    }

    if (cliOptions.useCache && html) {
        await writeToCache(url, html).catch((error) => {
            console.error(`Failed to write cache: ${error.message}`);
        });
    }

    return html;
}

function getCacheFilePath(url) {
    const hash = createHash('sha256').update(url).digest('hex');
    return path.join(CACHE_DIR, `${hash}.html`);
}

async function readFromCache(url) {
    try {
        if (!fsSync.existsSync(CACHE_DIR)) {
            return null;
        }
        const filePath = getCacheFilePath(url);
        return await fs.readFile(filePath, 'utf8');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`Failed to read cache: ${error.message}`);
        }
        return null;
    }
}

async function writeToCache(url, content) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const filePath = getCacheFilePath(url);
    await fs.writeFile(filePath, content, 'utf8');
}

async function clearCacheDirectory() {
    await fs.rm(CACHE_DIR, { recursive: true, force: true });
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

        if (args.length === 1 && args[0] === '--clear-cache') {
            await clearCacheDirectory();
            console.log('Cache cleared.');
            return;
        }

        const { url, options } = parseArguments(args);

        if (options.clearCache) {
            await clearCacheDirectory();
        }

        const html = await fetchHtml(url, options);
        if (!html) {
            process.exitCode = 1;
            return;
        }
        process.stdout.write(html, () => process.exit(0));
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 1;
    }
})();
