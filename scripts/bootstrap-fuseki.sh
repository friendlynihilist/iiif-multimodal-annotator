#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# bootstrap-fuseki.sh — idempotent ontology loader for the Multimodal
# Annotator's Fuseki instance.
#
# Phase 1 (T1.3). Re-runnable any time a profile's ontology.ttl changes;
# safe to invoke against a Fuseki that already has the graphs loaded
# (Graph Store Protocol PUT replaces the graph contents).
#
# What it does, in order:
#   1. Polls Fuseki at $FUSEKI_URL/$/ping until it answers 200 (timeout 60s).
#   2. For every profiles/<id>/ontology.ttl, PUTs the file into the named
#      graph $GRAPH_BASE/<id> on dataset $FUSEKI_DATASET via the Graph
#      Store Protocol.
#   3. Runs a COUNT SPARQL query to verify the graph contains triples,
#      and prints the count.
#
# Usage:
#   docker compose up -d
#   ./scripts/bootstrap-fuseki.sh
#
# Environment (reads from .env if present, with the same defaults as
# .env.example):
#   FUSEKI_URL              default http://localhost:3030
#   FUSEKI_DATASET          default ds
#   FUSEKI_ADMIN_USER       default admin
#   FUSEKI_ADMIN_PASSWORD   default changeme
#   PROFILES_DIR            default ./profiles
#   BASE_NS                 default https://w3id.org/multimodal-annotator/ns/
#                           (combined with /graphs/ontology/<id> for the
#                            named-graph IRI)
#
# Requires: bash, curl, jq.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." &>/dev/null && pwd)"

# Load .env if present (export everything declared there).
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

FUSEKI_URL="${FUSEKI_URL:-http://localhost:3030}"
FUSEKI_DATASET="${FUSEKI_DATASET:-ds}"
FUSEKI_ADMIN_USER="${FUSEKI_ADMIN_USER:-admin}"
FUSEKI_ADMIN_PASSWORD="${FUSEKI_ADMIN_PASSWORD:-changeme}"
PROFILES_DIR="${PROFILES_DIR:-$REPO_ROOT/profiles}"
BASE_NS="${BASE_NS:-https://w3id.org/multimodal-annotator/ns/}"
GRAPH_BASE="${BASE_NS%/}/graphs/ontology"

# If running outside the docker network and FUSEKI_URL is the in-compose
# hostname, rewrite it to localhost so this script (which runs on the host)
# can still reach Fuseki on the published port.
if [[ "$FUSEKI_URL" == "http://fuseki:3030" ]]; then
  FUSEKI_URL="http://localhost:3030"
fi

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required tool: $1" >&2
    exit 2
  }
}
require curl
require jq

color() { printf '\033[%sm%s\033[0m' "$1" "$2"; }
ok()    { color "32" "OK"; }
warn()  { color "33" "WARN"; }
err()   { color "31" "ERR"; }

# 1. Wait for /$/ping.
echo "Waiting for Fuseki at ${FUSEKI_URL}/\$/ping ..."
deadline=$(( $(date +%s) + 60 ))
while :; do
  if curl -fsS "${FUSEKI_URL}/\$/ping" >/dev/null 2>&1; then
    echo "$(ok) Fuseki is up."
    break
  fi
  if (( $(date +%s) > deadline )); then
    echo "$(err) Fuseki did not respond within 60s." >&2
    exit 1
  fi
  sleep 1
done

# 2. Load each profile's ontology.
shopt -s nullglob
loaded=0
skipped=0
for profile_dir in "$PROFILES_DIR"/*/; do
  profile_id="$(basename "$profile_dir")"
  ontology_file="${profile_dir}ontology.ttl"
  if [[ ! -f "$ontology_file" ]]; then
    echo "$(warn) Profile '$profile_id' has no ontology.ttl — skipping."
    skipped=$((skipped + 1))
    continue
  fi

  graph_iri="${GRAPH_BASE}/${profile_id}"
  echo "Loading $ontology_file"
  echo "   into <${graph_iri}>"

  http_code=$(curl -sS -o /tmp/mma-bootstrap.out -w '%{http_code}' \
    -u "${FUSEKI_ADMIN_USER}:${FUSEKI_ADMIN_PASSWORD}" \
    -X PUT \
    -H "Content-Type: text/turtle; charset=utf-8" \
    --data-binary "@${ontology_file}" \
    "${FUSEKI_URL}/${FUSEKI_DATASET}/data?graph=$(printf %s "$graph_iri" | jq -sRr @uri)")
  if [[ "$http_code" != "200" && "$http_code" != "201" && "$http_code" != "204" ]]; then
    echo "$(err) PUT returned HTTP $http_code:" >&2
    cat /tmp/mma-bootstrap.out >&2
    exit 1
  fi

  # 3. Verify with COUNT.
  count_json=$(curl -fsS \
    -u "${FUSEKI_ADMIN_USER}:${FUSEKI_ADMIN_PASSWORD}" \
    -G \
    --data-urlencode "query=SELECT (COUNT(*) AS ?c) WHERE { GRAPH <${graph_iri}> { ?s ?p ?o } }" \
    -H "Accept: application/sparql-results+json" \
    "${FUSEKI_URL}/${FUSEKI_DATASET}/sparql")
  count=$(printf %s "$count_json" | jq -r '.results.bindings[0].c.value')

  if [[ -z "$count" || "$count" == "0" ]]; then
    echo "$(err) Graph <${graph_iri}> reports $count triples after PUT." >&2
    exit 1
  fi
  echo "   $(ok) ${count} triples loaded."
  loaded=$((loaded + 1))
done

echo
echo "─── Bootstrap summary ──────────────────────────────────────────"
echo "  profiles loaded:  $loaded"
echo "  profiles skipped: $skipped"
echo "  dataset:          ${FUSEKI_URL}/${FUSEKI_DATASET}"
echo "  graph base:       ${GRAPH_BASE}/<profile_id>"
