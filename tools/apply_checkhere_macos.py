from pathlib import Path

root = Path('.')

launcher = r'''#!/bin/bash
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
'''

launcher_path = root / 'checkhere' / '체크히어 시작.command'
launcher_path.write_text(launcher, encoding='utf-8', newline='\n')
launcher_path.chmod(0o755)

ui = root / 'checkhere-ui.mjs'
s = ui.read_text(encoding='utf-8')
replacements = {
    '<summary>윈도우 연결 프로그램 설정</summary>': '<summary>수집 연결 프로그램 설정</summary>',
    '이 PC에서 ‘체크히어 시작’을 실행하세요.': 'Windows에서는 ‘체크히어 시작.cmd’, macOS에서는 ‘체크히어 시작.command’를 실행하세요.',
    'aria-label="윈도우 연결 키"': 'aria-label="로컬 연결 키"',
    "윈도우 연결 키를 먼저 입력해 주세요.": "로컬 연결 키를 먼저 입력해 주세요.",
    "윈도우 연결 프로그램에 연결하지 못했습니다. ‘체크히어 시작’을 실행하고 브라우저의 로컬 네트워크 연결 허용 여부를 확인해 주세요.": "수집 연결 프로그램에 연결하지 못했습니다. Windows의 ‘체크히어 시작.cmd’ 또는 macOS의 ‘체크히어 시작.command’를 실행하고 브라우저의 로컬 네트워크 연결 허용 여부를 확인해 주세요.",
    "key?'PC 연결됨 · 로그인 확인'": "key?'로컬 연결됨 · 로그인 확인'",
}
for old, new in replacements.items():
    if old not in s:
        raise SystemExit(f'checkhere-ui anchor missing: {old}')
    s = s.replace(old, new)
ui.write_text(s, encoding='utf-8')

portal = root / 'checkhere-portal.mjs'
s = portal.read_text(encoding='utf-8')
old = "./checkhere-ui.mjs?v=20260910-review2"
new = "./checkhere-ui.mjs?v=20260910-review3"
if old not in s:
    raise SystemExit('checkhere-portal cache anchor missing')
portal.write_text(s.replace(old, new, 1), encoding='utf-8')

vi = root / '.vercelignore'
s = vi.read_text(encoding='utf-8')
if 'checkhere/*.command' not in s:
    s = s.rstrip() + '\ncheckhere/*.command\n'
vi.write_text(s, encoding='utf-8')

readme = root / 'checkhere' / 'README.md'
s = readme.read_text(encoding='utf-8')
s = s.replace('Windows 연결 프로그램입니다.', 'Windows·macOS 로컬 연결 프로그램입니다.', 1)
if '## 이 PC에서 실행' in s:
    s = s.replace('## 이 PC에서 실행', '## Windows에서 실행', 1)
mac_section = '''## macOS에서 실행

1. Google Chrome과 Node.js 24 이상을 준비합니다. `체크히어 시작.command`는 프로젝트의 `runtime/node`, Codex 런타임, Homebrew, Volta, asdf, mise 및 일반 PATH 순서로 Node를 찾습니다.
2. `체크히어 시작.command`를 더블클릭합니다. Git clone으로 받은 파일은 실행 권한이 유지됩니다. ZIP 등으로 받아 실행 권한이 사라진 경우 터미널에서 `chmod +x "체크히어 시작.command"`를 한 번 실행합니다.
3. 첫 실행에서 Playwright가 없으면 같은 폴더의 `package.json`을 기준으로 npm 의존성을 자동 설치합니다. Playwright 자체 Chromium은 받지 않고 설치된 Google Chrome을 사용합니다.
4. `http://127.0.0.1:8765`가 Chrome에서 자동으로 열립니다. **체크히어 로그인**을 누르고 새 전용 Chrome 창에서 로그인합니다. macOS에서도 `data/chrome-profile`에 전용 로그인 세션이 유지됩니다.
5. 운영 포털의 **체크히어** 탭에서 로컬 화면의 연결 키를 입력하고 수집합니다. 브라우저가 로컬 네트워크 접근을 묻는 경우 허용해야 합니다.
6. 이후 수집·검토·지정 관리자 수정·Firebase 보관 흐름은 Windows와 동일합니다. Windows의 `Start.ps1` 및 `.cmd` 파일은 그대로 유지됩니다.

> macOS 실행기는 Apple Silicon과 Intel Mac의 일반적인 Homebrew 경로를 모두 확인합니다. 실제 체크히어 화면 DOM과 로그인 정책은 Windows와 동일한 Playwright 수집기를 사용하므로, 최초 배포 후 실제 Mac에서 로그인 → 1개 반·1개 날짜 수집 → 읽기 전용 검수까지 먼저 확인한 뒤 수정 기능을 사용하는 것을 권장합니다.

'''
if '## macOS에서 실행' not in s:
    marker = '## 플랫폼 연결\n'
    if marker not in s:
        raise SystemExit('README platform marker missing')
    s = s.replace(marker, mac_section + marker, 1)
readme.write_text(s, encoding='utf-8')
