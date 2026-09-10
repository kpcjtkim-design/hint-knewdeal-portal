#!/bin/bash
set -u

BRIDGE_ROOT="$(cd "$(dirname "$0")" && pwd -P)"
cd "$BRIDGE_ROOT" || exit 1
BRIDGE_URL="http://127.0.0.1:8765"
LOG_FILE="$BRIDGE_ROOT/bridge.log"
ERR_FILE="$BRIDGE_ROOT/bridge-error.log"

export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/opt/node@24/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.asdf/shims:$HOME/.local/share/mise/shims:$PATH"

fail() {
  echo
  echo "[체크히어] $1"
  echo
  read -r -p "Enter를 누르면 창을 닫습니다... " _
  exit 1
}

if [ "$(uname -s 2>/dev/null)" != "Darwin" ]; then
  fail "이 실행기는 macOS 전용입니다. Windows에서는 체크히어 시작.cmd를 사용해 주세요."
fi

if ! open -Ra "Google Chrome" >/dev/null 2>&1; then
  fail "Google Chrome이 설치되어 있지 않습니다. Chrome 설치 후 다시 실행해 주세요."
fi

find_node() {
  for candidate in \
    "$BRIDGE_ROOT/runtime/node" \
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" \
    "/opt/homebrew/opt/node@24/bin/node" \
    "/opt/homebrew/bin/node" \
    "/usr/local/opt/node@24/bin/node" \
    "/usr/local/bin/node" \
    "$HOME/.volta/bin/node" \
    "$HOME/.asdf/shims/node" \
    "$HOME/.local/share/mise/shims/node"
  do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  command -v node 2>/dev/null || return 1
}

NODE_BIN="$(find_node)" || fail "Node.js 24 이상을 찾지 못했습니다. Node.js 24 이상을 설치한 뒤 다시 실행해 주세요."
NODE_MAJOR="$($NODE_BIN -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
case "$NODE_MAJOR" in
  ''|*[!0-9]*) NODE_MAJOR=0 ;;
esac
if [ "$NODE_MAJOR" -lt 24 ]; then
  fail "현재 Node.js는 $($NODE_BIN -v 2>/dev/null || echo '버전 확인 실패')입니다. Node.js 24 이상이 필요합니다."
fi

echo "[체크히어] Node $($NODE_BIN -v) 확인"

if ! "$NODE_BIN" -e "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  NPM_BIN="$(dirname "$NODE_BIN")/npm"
  if [ ! -x "$NPM_BIN" ]; then
    NPM_BIN="$(command -v npm 2>/dev/null || true)"
  fi
  [ -n "$NPM_BIN" ] || fail "Playwright가 없고 npm도 찾지 못했습니다. Node.js 24의 npm 설치 상태를 확인해 주세요."
  echo "[체크히어] 첫 실행 의존성을 설치합니다..."
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 "$NPM_BIN" install --no-audit --no-fund || fail "의존성 설치에 실패했습니다. 인터넷 연결과 npm 상태를 확인해 주세요."
fi

EXPECTED_BUILD="$(sed -n "s/.*build:'\([^']*\)'.*/\1/p" "$BRIDGE_ROOT/server.mjs" | head -n 1)"
LISTENER_PID="$(lsof -nP -tiTCP:8765 -sTCP:LISTEN 2>/dev/null | head -n 1)"
BRIDGE_RUNNING=0

if [ -n "$LISTENER_PID" ]; then
  SESSION="$(curl -fsS --max-time 2 "$BRIDGE_URL/api/session" 2>/dev/null || true)"
  if [ -n "$SESSION" ] && { [ -z "$EXPECTED_BUILD" ] || printf '%s' "$SESSION" | grep -Fq "\"build\":\"$EXPECTED_BUILD\""; }; then
    BRIDGE_RUNNING=1
    echo "[체크히어] 이미 실행 중인 최신 연결 프로그램을 사용합니다."
  else
    RUNNING_CMD="$(ps -p "$LISTENER_PID" -o command= 2>/dev/null || true)"
    case "$RUNNING_CMD" in
      *server.mjs*)
        echo "[체크히어] 기존 연결 프로그램을 종료하고 최신 버전으로 다시 시작합니다."
        kill "$LISTENER_PID" 2>/dev/null || fail "기존 연결 프로그램을 종료하지 못했습니다."
        sleep 2
        ;;
      *)
        fail "8765 포트를 다른 프로그램이 사용 중입니다. 해당 프로그램을 종료한 뒤 다시 실행해 주세요."
        ;;
    esac
  fi
fi

if [ "$BRIDGE_RUNNING" -ne 1 ]; then
  : > "$ERR_FILE"
  touch "$LOG_FILE"
  nohup "$NODE_BIN" "$BRIDGE_ROOT/server.mjs" >>"$LOG_FILE" 2>>"$ERR_FILE" </dev/null &
  BRIDGE_PID=$!
  READY=0
  COUNT=0
  while [ "$COUNT" -lt 30 ]; do
    if curl -fsS --max-time 1 "$BRIDGE_URL/api/session" >/dev/null 2>&1; then
      READY=1
      break
    fi
    if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
      break
    fi
    sleep 0.5
    COUNT=$((COUNT + 1))
  done
  if [ "$READY" -ne 1 ]; then
    echo
    echo "----- bridge-error.log -----"
    tail -n 20 "$ERR_FILE" 2>/dev/null || true
    fail "연결 프로그램이 정상적으로 시작되지 않았습니다. 위 오류 내용을 확인해 주세요."
  fi
  echo "[체크히어] 로컬 연결 프로그램 시작 완료"
fi

open -a "Google Chrome" "$BRIDGE_URL" || fail "Chrome에서 로컬 화면을 열지 못했습니다."
echo "[체크히어] Chrome에서 $BRIDGE_URL 을 열었습니다."
echo "[체크히어] 처음이면 '체크히어 로그인'을 눌러 전용 Chrome 창에서 로그인하세요."
echo "[체크히어] 이 터미널 창은 닫아도 수집 프로그램은 계속 실행됩니다."
sleep 2
exit 0
