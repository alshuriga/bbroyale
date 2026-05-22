#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN_FILE="${ROOT_DIR}/vercel-token.txt"
TOKEN="${VERCEL_TOKEN:-}"
SCOPE="${VERCEL_SCOPE:-alshuriga-8124s-projects}"

if [[ -z "${TOKEN}" && -f "${TOKEN_FILE}" ]]; then
  TOKEN="$(tr -d '[:space:]' < "${TOKEN_FILE}")"
fi

if [[ -z "${TOKEN}" ]]; then
  echo "Missing VERCEL_TOKEN. Set env var or put token into vercel-token.txt" >&2
  exit 1
fi

TMP_HOME="${TMPDIR:-/tmp}/bbroyale-vercel-home"
TMP_NPM_CACHE="${TMPDIR:-/tmp}/bbroyale-npm-cache"
mkdir -p "${TMP_HOME}/.local/share" "${TMP_HOME}/.cache" "${TMP_HOME}/.config" "${TMP_NPM_CACHE}"

cd "${ROOT_DIR}"
if [[ -n "${SCOPE}" ]]; then
  SCOPE_ARG=(--scope "${SCOPE}")
else
  SCOPE_ARG=()
fi

HOME="${TMP_HOME}" \
XDG_CACHE_HOME="${TMP_HOME}/.cache" \
XDG_CONFIG_HOME="${TMP_HOME}/.config" \
npm_config_cache="${TMP_NPM_CACHE}" \
npx --yes vercel --prod --token "${TOKEN}" "${SCOPE_ARG[@]}"
