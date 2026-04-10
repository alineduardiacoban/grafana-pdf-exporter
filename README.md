# Grafana PDF Exporter

Export Grafana dashboards to PDF — including **full table expansion** so every row is visible, not just what fits in the viewport.

Runs as a lightweight Node.js HTTP server. Works with Docker, systemd, or plain `node src/server.js`.

> Inspired by [arthur-mdn/ExportGrafanaDashboardToPDF](https://github.com/arthur-mdn/ExportGrafanaDashboardToPDF).

---

## Features

- Exports any Grafana dashboard to a single-page PDF
- **Expands all table rows** — removes scroll/overflow constraints and flushes virtual rendering so no data is hidden
- Auto-calculates PDF height from the actual rendered page
- Supports username/password and Service Account token authentication
- Optional: inject a one-click export button directly into Grafana dashboards
- Optional: trigger exports via cURL, shell script, or cron

---

## Requirements

- Node.js ≥ 18
- A running Grafana instance
- Chromium or Google Chrome — system-installed or bundled by Puppeteer

---

## Quick start

```bash
git clone https://github.com/alineduardiacoban/grafana-pdf-exporter
cd grafana-pdf-exporter

npm install

cp .env.template .env
# edit .env — set GRAFANA_URL, GRAFANA_USER, GRAFANA_PASSWORD

node src/server.js
```

Test it:

```bash
curl -s \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"url": "http://localhost:3000/d/YOUR_DASHBOARD_UID"}' \
  http://localhost:3001/generate-pdf
```

Response:

```json
{
  "success": true,
  "url": "http://localhost:3001/output/my_dashboard_1234567890.pdf",
  "filename": "my_dashboard_1234567890.pdf"
}
```

PDFs are saved in `output/` and served at `http://localhost:3001/output/<filename>.pdf`.

---

## Chromium setup

By default, `npm install` downloads Puppeteer's bundled Chromium (~300 MB) automatically — nothing extra to configure.

To use a system-installed browser instead, set `CHROMIUM_PATH` in `.env` and install `puppeteer-core`:

```bash
npm install puppeteer-core
```

```env
# AlmaLinux / RHEL
CHROMIUM_PATH=/usr/bin/chromium

# Debian / Ubuntu
CHROMIUM_PATH=/usr/bin/chromium-browser

# Google Chrome
CHROMIUM_PATH=/usr/bin/google-chrome
```

---

## Running as a systemd service

**1. Copy files**

```bash
sudo cp -r . /opt/grafana-pdf-exporter
sudo mkdir -p /opt/grafana-pdf-exporter/output
```

**2. Create a service user**

```bash
sudo useradd --system --no-create-home --shell /sbin/nologin grafana-pdf
sudo chown -R grafana-pdf:grafana-pdf /opt/grafana-pdf-exporter
```

**3. Install dependencies**

```bash
cd /opt/grafana-pdf-exporter
sudo -u grafana-pdf npm install
```

**4. Configure**

```bash
sudo cp .env.template .env
sudo nano .env
```

**5. Create the service unit**

```bash
sudo nano /etc/systemd/system/grafana-pdf-exporter.service
```

```ini
[Unit]
Description=Grafana PDF Exporter
After=network.target grafana-server.service
Wants=grafana-server.service

[Service]
Type=simple
User=grafana-pdf
Group=grafana-pdf
WorkingDirectory=/opt/grafana-pdf-exporter
EnvironmentFile=/opt/grafana-pdf-exporter/.env
ExecStart=/usr/bin/node /opt/grafana-pdf-exporter/src/server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=grafana-pdf-exporter
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
```

> Verify the node path: `which node`

**6. Start**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now grafana-pdf-exporter
systemctl status grafana-pdf-exporter
```

---

## Usage

### cURL

```bash
# Basic
curl -s -H "Content-Type: application/json" -X POST \
  -d '{"url": "http://localhost:3000/d/YOUR_UID"}' \
  http://localhost:3001/generate-pdf

# With time range
curl -s -H "Content-Type: application/json" -X POST \
  -d '{"url": "http://localhost:3000/d/YOUR_UID", "from": "now-7d", "to": "now"}' \
  http://localhost:3001/generate-pdf
```

### Shell script

```bash
chmod +x generate-pdf.sh

./generate-pdf.sh GF_DASH_URL 'http://localhost:3000/d/YOUR_UID'
./generate-pdf.sh GF_DASH_URL 'http://localhost:3000/d/YOUR_UID' GF_FROM 'now-7d' GF_TO 'now'
./generate-pdf.sh GF_DASH_URL 'http://localhost:3000/d/YOUR_UID' GF_PDF_WIDTH_PX 2560
```

### Dashboard button (optional)

**1.** In `grafana.ini`:

```ini
[panels]
disable_sanitize_html = true
```

Restart Grafana after saving.

**2.** Add a **Text** panel to your dashboard, set it to **HTML** mode, and paste the contents of `grafana-button.html`.

**3.** If Grafana is accessed from another machine, update the server URL inside the file:

```js
var SERVER_URL = 'http://<exporter-host>:3001';
```

---

## Configuration reference

| Variable | Default | Description |
|---|---|---|
| `GRAFANA_URL` | `http://localhost:3000` | Grafana base URL |
| `GRAFANA_USER` | `admin` | Login username |
| `GRAFANA_PASSWORD` | `admin` | Login password or Service Account token |
| `GRAFANA_SERVICE_ACCOUNT` | `false` | Set `true` to use a Service Account token |
| `CHROMIUM_PATH` | *(unset)* | Path to system browser; unset = Puppeteer's bundled Chromium |
| `PORT` | `3001` | HTTP server port |
| `PDF_WIDTH_PX` | `1920` | Viewport width in pixels |
| `PDF_HEIGHT_PX` | `auto` | `auto` = full rendered page height |
| `EXPAND_TABLE_PANELS` | `true` | Expand all table rows — no data cut off |
| `EXPAND_COLLAPSED_PANELS` | `true` | Expand collapsed dashboard rows |
| `FORCE_KIOSK_MODE` | `true` | Append `?kiosk` to hide navigation |
| `HIDE_DASHBOARD_CONTROLS` | `true` | Hide time picker and toolbar |
| `NAVIGATION_TIMEOUT` | `60000` | Page load timeout (ms) |
| `CHECK_QUERIES_TO_COMPLETE` | `false` | Wait for all panel queries before rendering *(experimental)* |
| `EXTRACT_DATE_AND_DASHBOARD_NAME_FROM_HTML_PANEL_ELEMENTS` | `false` | Human-readable filenames from injected HTML elements |
| `DEBUG_MODE` | `false` | Save HTML snapshot to `debug/` |

---

## Service management

```bash
systemctl status grafana-pdf-exporter
journalctl -u grafana-pdf-exporter -f
systemctl restart grafana-pdf-exporter
systemctl stop grafana-pdf-exporter
```

---

## Troubleshooting

**Tables still cut off** — confirm `EXPAND_TABLE_PANELS=true` and `PDF_HEIGHT_PX=auto`. For slow dashboards, increase `NAVIGATION_TIMEOUT` or enable `CHECK_QUERIES_TO_COMPLETE=true`.

**Chromium not found** — run `which chromium chromium-browser google-chrome` and set `CHROMIUM_PATH` in `.env`.

**Popup blocked** — allow popups for your Grafana host in the browser address bar.

**Out of memory / crash** — check with `free -h`. Reduce `PDF_WIDTH_PX` or export dashboards individually.

**Permission denied on `output/`**
```bash
sudo chown -R grafana-pdf:grafana-pdf /opt/grafana-pdf-exporter/output
```
