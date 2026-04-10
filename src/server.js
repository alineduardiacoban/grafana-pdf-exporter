'use strict';

try { require('dotenv').config(); } catch { /* dotenv is optional */ }

const express = require('express');
const path    = require('path');
const { generatePdf, config, OUTPUT_DIR } = require('./grafana_pdf');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.post('/generate-pdf', async (req, res) => {
    const { url, from, to, pdfWidthPx, pdfHeightPx } = req.body;
    if (!url) return res.status(400).json({ error: '"url" is required.' });

    console.log(`[INFO] PDF requested — ${url}`);
    try {
        const filename = await generatePdf({ url, from, to, pdfWidthPx, pdfHeightPx });
        const pdfUrl   = `http://localhost:${PORT}/output/${filename}`;
        console.log(`[INFO] PDF ready    — ${filename}`);
        res.json({ success: true, url: pdfUrl, filename });
    } catch (err) {
        console.error('[ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', port: PORT, grafana: config.grafanaUrl }));

app.use('/output', express.static(OUTPUT_DIR));

app.listen(PORT, () => {
    console.log('─────────────────────────────────────────');
    console.log(' Grafana PDF Exporter');
    console.log('─────────────────────────────────────────');
    console.log(` Listening : http://localhost:${PORT}`);
    console.log(` Grafana   : ${config.grafanaUrl}`);
    console.log(` Tables    : ${config.expandTablePanels}`);
    console.log(` Height    : ${config.defaultHeightPx}`);
    console.log('─────────────────────────────────────────');
});
