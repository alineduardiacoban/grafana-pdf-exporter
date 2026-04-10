'use strict';

const path = require('path');
const fs   = require('fs');

let puppeteer;
if (process.env.CHROMIUM_PATH) {
    puppeteer = require('puppeteer-core');
} else {
    try {
        puppeteer = require('puppeteer');
    } catch {
        puppeteer = require('puppeteer-core');
    }
}

// ── Config ─────────────────────────────────────────────────────────────────────

const config = {
    grafanaUrl:     process.env.GRAFANA_URL      || 'http://localhost:3000',
    grafanaUser:    process.env.GRAFANA_USER      || 'admin',
    grafanaPass:    process.env.GRAFANA_PASSWORD  || 'admin',
    serviceAccount: process.env.GRAFANA_SERVICE_ACCOUNT === 'true',
    chromiumPath:   process.env.CHROMIUM_PATH    || null,

    defaultWidthPx:  parseInt(process.env.PDF_WIDTH_PX) || 1920,
    defaultHeightPx: process.env.PDF_HEIGHT_PX           || 'auto',

    forceKioskMode:        process.env.FORCE_KIOSK_MODE        !== 'false',
    hideDashboardControls: process.env.HIDE_DASHBOARD_CONTROLS !== 'false',
    expandCollapsedPanels: process.env.EXPAND_COLLAPSED_PANELS !== 'false',
    expandTablePanels:     process.env.EXPAND_TABLE_PANELS     !== 'false',

    navigationTimeout: parseInt(process.env.NAVIGATION_TIMEOUT) || 60000,

    checkQueries:         process.env.CHECK_QUERIES_TO_COMPLETE === 'true',
    checkQueriesInterval: parseInt(process.env.CHECK_QUERIES_TO_COMPLETE_QUERIES_INTERVAL)           || 1000,
    checkQueriesTimeout:  parseInt(process.env.CHECK_QUERIES_TO_COMPLETE_QUERIES_COMPLETION_TIMEOUT) || 60000,

    extractMeta: process.env.EXTRACT_DATE_AND_DASHBOARD_NAME_FROM_HTML_PANEL_ELEMENTS === 'true',
    debugMode:   process.env.DEBUG_MODE === 'true',
};

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const DEBUG_DIR  = path.join(__dirname, '..', 'debug');

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildDashboardUrl(rawUrl, from, to) {
    let url;
    try       { url = new URL(rawUrl); }
    catch (_) { url = new URL(rawUrl, config.grafanaUrl); }

    if (from) url.searchParams.set('from', from);
    if (to)   url.searchParams.set('to',   to);
    if (config.forceKioskMode && !url.searchParams.has('kiosk')) {
        url.searchParams.set('kiosk', '');
    }
    return url.toString();
}

function buildFilename(finalUrl, from, to) {
    const url      = new URL(finalUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    const dIdx     = segments.indexOf('d');
    const slug     = dIdx >= 0 ? (segments[dIdx + 2] || segments[dIdx + 1]) : 'dashboard';
    const clean    = s => (s || '').replace(/[/\\?%*:|"<>]/g, '-');

    return [slug, clean(from || url.searchParams.get('from')), clean(to || url.searchParams.get('to')), Date.now()]
        .filter(Boolean)
        .join('_')
        .replace(/_+/g, '_')
        .substring(0, 200) + '.pdf';
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Steps ──────────────────────────────────────────────────────────────────────

async function authenticate(page) {
    if (config.serviceAccount) {
        await page.setExtraHTTPHeaders({ Authorization: `Bearer ${config.grafanaPass}` });
        return;
    }
    await page.goto(new URL('/login', config.grafanaUrl).toString(), {
        waitUntil: 'networkidle2', timeout: config.navigationTimeout,
    });
    await page.waitForSelector(
        'input[name="user"], input[name="username"], input[placeholder*="email"]',
        { timeout: 10_000 }
    );
    await page.type(
        'input[name="user"], input[name="username"], input[placeholder*="email"]',
        config.grafanaUser, { delay: 30 }
    );
    await page.type('input[name="password"]', config.grafanaPass, { delay: 30 });
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: config.navigationTimeout }),
        page.keyboard.press('Enter'),
    ]);
}

async function hideControls(page) {
    await page.addStyleTag({ content: `
        .navbar, .sidemenu, nav[aria-label="Breadcrumb"],
        [data-testid="data-testid NavToolbar"],
        .dashboard-controls, .panel-menu-container,
        .grafana-toolbar, .css-toolbar { display: none !important; }
    `});
}

async function expandCollapsedRows(page) {
    await page.evaluate(async () => {
        const rows = document.querySelectorAll(
            '[data-testid="dashboard-row-title-button"][aria-expanded="false"], .dashboard-row__title.pointer'
        );
        for (const r of rows) { r.click(); await new Promise(x => setTimeout(x, 300)); }
    });
    await delay(1000);
}

async function expandTablePanels(page) {
    await page.evaluate(async () => {
        for (const el of document.querySelectorAll(
            '[data-testid="table-container"], .scrollbar-view, .panel-content .scrollbar-view'
        )) {
            el.style.overflow  = 'visible';
            el.style.height    = 'auto';
            el.style.maxHeight = 'none';
        }
        for (const panel of document.querySelectorAll('.react-grid-item')) {
            if (!panel.querySelector('table, [role="table"], [data-testid="table-container"]')) continue;
            const inner = panel.querySelector('.panel-container, .grafana-panel');
            if (inner) { inner.style.overflow = 'visible'; inner.style.height = 'auto'; }
            panel.style.position  = 'relative';
            panel.style.height    = 'auto';
            panel.style.transform = 'none';
        }
        for (const s of document.querySelectorAll(
            '[role="table"] .scrollbar-view, [data-testid="table-container"] .scrollbar-view'
        )) {
            s.scrollTop = s.scrollHeight;
            await new Promise(x => setTimeout(x, 200));
            s.scrollTop = 0;
        }
    });
    await delay(2000);

    await page.evaluate(() => {
        document.querySelectorAll('[style*="overflow"]').forEach(el => {
            const s = window.getComputedStyle(el);
            if (s.overflow === 'hidden' || s.overflowY === 'hidden') {
                el.style.overflow  = 'visible';
                el.style.height    = 'auto';
                el.style.maxHeight = 'none';
            }
        });
        const grid = document.querySelector('.react-grid-layout');
        if (grid) { grid.style.height = 'auto'; grid.style.minHeight = grid.scrollHeight + 'px'; }
    });
    await delay(1500);
}

async function waitForQueries(page) {
    const deadline = Date.now() + config.checkQueriesTimeout;
    while (Date.now() < deadline) {
        const loading = await page.evaluate(() =>
            document.querySelectorAll('[data-testid="panel-loading-bar"]').length > 0
        );
        if (!loading) return;
        await delay(config.checkQueriesInterval);
    }
}

async function getPageHeight(page) {
    return page.evaluate(() => {
        const grid = document.querySelector('.react-grid-layout');
        return Math.max(
            document.body.scrollHeight, document.body.offsetHeight,
            document.documentElement.scrollHeight,
            grid ? grid.scrollHeight : 0
        );
    });
}

// ── Public API ─────────────────────────────────────────────────────────────────

async function generatePdf({ url, from, to, pdfWidthPx, pdfHeightPx } = {}) {
    if (!url) throw new Error('"url" parameter is required.');

    if (config.chromiumPath && !fs.existsSync(config.chromiumPath)) {
        throw new Error(
            `Chromium not found at "${config.chromiumPath}". ` +
            `Run "which chromium" and update CHROMIUM_PATH in .env.`
        );
    }

    const finalUrl    = buildDashboardUrl(url, from, to);
    const widthPx     = pdfWidthPx || config.defaultWidthPx;
    const heightArg   = pdfHeightPx !== undefined ? pdfHeightPx : config.defaultHeightPx;
    const autoHeight  = String(heightArg).toLowerCase() === 'auto';
    const fixedHeight = autoHeight ? 1080 : (parseInt(heightArg) || 1080);

    if (config.debugMode) console.log('[DEBUG] URL:', finalUrl, '| Viewport:', widthPx, 'x', fixedHeight);

    const launchOptions = {
        headless: 'new',
        args: [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-gpu', '--no-first-run', '--no-zygote', '--disable-extensions',
        ],
    };
    if (config.chromiumPath) launchOptions.executablePath = config.chromiumPath;

    const browser = await puppeteer.launch(launchOptions);

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: widthPx, height: fixedHeight, deviceScaleFactor: 1 });

        await authenticate(page);
        await page.goto(finalUrl, { waitUntil: 'networkidle2', timeout: config.navigationTimeout });

        if (config.hideDashboardControls) await hideControls(page);
        if (config.expandCollapsedPanels) await expandCollapsedRows(page);
        if (config.expandTablePanels)     await expandTablePanels(page);
        if (config.checkQueries)          await waitForQueries(page);

        const renderedHeight = await getPageHeight(page);
        const finalHeight    = autoHeight ? Math.max(renderedHeight, fixedHeight) : fixedHeight;
        await page.setViewport({ width: widthPx, height: finalHeight, deviceScaleFactor: 1 });
        await delay(500);

        if (config.debugMode) {
            fs.mkdirSync(DEBUG_DIR, { recursive: true });
            fs.writeFileSync(path.join(DEBUG_DIR, `debug_${Date.now()}.html`), await page.content());
        }

        let filename;
        if (config.extractMeta) {
            const title = await page.$eval('#gfexp_display_actual_dashboard_title', el => el.textContent.trim()).catch(() => null);
            const date  = await page.$eval('#gfexp_display_actual_date', el => el.textContent.trim()).catch(() => null);
            if (title) {
                const safe = s => s.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim().replace(/ +/g, '_');
                filename = `${safe(title)}${date ? '_' + safe(date) : ''}.pdf`;
            }
        }
        if (!filename) filename = buildFilename(finalUrl, from, to);

        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        await page.pdf({
            path: path.join(OUTPUT_DIR, filename),
            width: `${widthPx}px`, height: `${finalHeight}px`,
            printBackground: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
        });

        return filename;

    } finally {
        await browser.close();
    }
}

module.exports = { generatePdf, config, OUTPUT_DIR };
