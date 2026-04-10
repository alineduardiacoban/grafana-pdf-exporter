#!/bin/bash
# generate-pdf.sh — trigger a PDF export from the command line
#
# Usage:
#   ./generate-pdf.sh GF_DASH_URL '<url>'
#   ./generate-pdf.sh GF_DASH_URL '<url>' GF_FROM 'now-7d' GF_TO 'now'
#   ./generate-pdf.sh GF_DASH_URL '<url>' GF_PDF_WIDTH_PX 2560
#
# Override server URL:
#   SERVER_URL=http://192.168.1.100:3001 ./generate-pdf.sh GF_DASH_URL '<url>'

set -euo pipefail

SERVER_URL="${SERVER_URL:-http://localhost:3001}"
GF_DASH_URL="" GF_FROM="" GF_TO="" GF_PDF_WIDTH_PX="" GF_PDF_HEIGHT_PX=""

while [[ $# -gt 0 ]]; do
    key="${1:-}"; val="${2:-}"; shift 2 || break
    case "$key" in
        GF_DASH_URL)      GF_DASH_URL="$val"      ;;
        GF_FROM)          GF_FROM="$val"           ;;
        GF_TO)            GF_TO="$val"             ;;
        GF_PDF_WIDTH_PX)  GF_PDF_WIDTH_PX="$val"  ;;
        GF_PDF_HEIGHT_PX) GF_PDF_HEIGHT_PX="$val" ;;
        *)
            echo "Unknown parameter: $key" >&2
            echo "Usage: $0 GF_DASH_URL <url> [GF_FROM <f>] [GF_TO <t>] [GF_PDF_WIDTH_PX <px>] [GF_PDF_HEIGHT_PX <px|auto>]" >&2
            exit 1 ;;
    esac
done

[[ -z "$GF_DASH_URL" ]] && { echo "Error: GF_DASH_URL is required." >&2; exit 1; }

PAYLOAD="{\"url\":\"${GF_DASH_URL}\""
[[ -n "$GF_FROM" ]]          && PAYLOAD+=", \"from\":\"${GF_FROM}\""
[[ -n "$GF_TO" ]]            && PAYLOAD+=", \"to\":\"${GF_TO}\""
[[ -n "$GF_PDF_WIDTH_PX" ]]  && PAYLOAD+=", \"pdfWidthPx\":${GF_PDF_WIDTH_PX}"
[[ -n "$GF_PDF_HEIGHT_PX" ]] && PAYLOAD+=", \"pdfHeightPx\":\"${GF_PDF_HEIGHT_PX}\""
PAYLOAD+="}"

echo "→ ${SERVER_URL}/generate-pdf"
echo "→ ${PAYLOAD}"

RESPONSE=$(curl -sf -H "Content-Type: application/json" -X POST -d "$PAYLOAD" \
    "${SERVER_URL}/generate-pdf") || {
    echo "Error: could not reach the server at ${SERVER_URL}." >&2
    echo "Is the service running?  systemctl status grafana-pdf-exporter" >&2
    exit 1
}

echo "${RESPONSE}"
PDF_URL=$(echo "$RESPONSE" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)
[[ -n "$PDF_URL" ]] && echo -e "\n✔ ${PDF_URL}"
