import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

// 프로젝트 루트 경로 (절대 경로) - 항상 유효한 값 보장
const PROJECT_ROOT = import.meta.dirname || process.cwd() || '.';
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");

// 환경 변수 기본값 설정 (모든 변수에 기본값 제공)
const NODE_ENV = process.env.NODE_ENV || 'development';
const CLIENT_DIR = process.env.CLIENT_DIR || path.join(PROJECT_ROOT, 'client');
const SHARED_DIR = process.env.SHARED_DIR || path.join(PROJECT_ROOT, 'shared');
const ASSETS_DIR = process.env.ASSETS_DIR || path.join(PROJECT_ROOT, 'attached_assets');
const DIST_DIR = process.env.DIST_DIR || path.join(PROJECT_ROOT, 'dist/public');
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch (error) {
    console.error(`Failed to trim log file ${logPath}:`, error);
  }
}

function writeLog(logPath: string, message: string) {
  try {
    ensureLogDir();
    fs.appendFileSync(logPath, `${message}\n`, "utf-8");
    trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
  } catch (error) {
    console.error(`Failed to write to log file ${logPath}:`, error);
  }
}

// =============================================================================
// Vite Plugin: Manus Debug Collector
// Injects a client-side script that collects browser logs and sends them to the server
// =============================================================================

function jsxLocPlugin(): Plugin {
  return {
    name: "jsx-loc",
    transform(code, id) {
      if (!id.includes("node_modules") && (id.endsWith(".jsx") || id.endsWith(".tsx"))) {
        return code;
      }
      return null;
    },
  };
}

function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "vite-plugin-manus-debug-collector",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const debugScript = `
          <script>
            (function() {
              const logs = {
                browserConsole: [],
                networkRequests: [],
                sessionReplay: [],
              };

              // Intercept console methods
              const originalLog = console.log;
              const originalWarn = console.warn;
              const originalError = console.error;

              function addLog(level, args) {
                const timestamp = new Date().toISOString();
                const message = args.map(arg => {
                  if (typeof arg === 'object') {
                    try {
                      return JSON.stringify(arg);
                    } catch {
                      return String(arg);
                    }
                  }
                  return String(arg);
                }).join(' ');

                logs.browserConsole.push({
                  timestamp,
                  level,
                  message,
                  stack: new Error().stack,
                });
              }

              console.log = function(...args) {
                addLog('log', args);
                originalLog.apply(console, args);
              };

              console.warn = function(...args) {
                addLog('warn', args);
                originalWarn.apply(console, args);
              };

              console.error = function(...args) {
                addLog('error', args);
                originalError.apply(console, args);
              };

              // Intercept fetch/XHR
              const originalFetch = window.fetch;
              window.fetch = function(...args) {
                const timestamp = new Date().toISOString();
                const startTime = performance.now();
                const url = args[0];

                return originalFetch.apply(window, args)
                  .then(response => {
                    const duration = performance.now() - startTime;
                    logs.networkRequests.push({
                      timestamp,
                      url: String(url),
                      status: response.status,
                      duration: Math.round(duration),
                    });
                    return response;
                  })
                  .catch(error => {
                    const duration = performance.now() - startTime;
                    logs.networkRequests.push({
                      timestamp,
                      url: String(url),
                      status: 0,
                      error: String(error),
                      duration: Math.round(duration),
                    });
                    throw error;
                  });
              };

              // Track user interactions
              document.addEventListener('click', (e) => {
                logs.sessionReplay.push({
                  timestamp: new Date().toISOString(),
                  type: 'click',
                  target: e.target?.tagName || 'unknown',
                  className: e.target?.className || '',
                });
              }, true);

              // Periodically send logs to server
              setInterval(() => {
                if (logs.browserConsole.length > 0 || logs.networkRequests.length > 0) {
                  navigator.sendBeacon('/api/debug-logs', JSON.stringify(logs));
                  logs.browserConsole = [];
                  logs.networkRequests = [];
                  logs.sessionReplay = [];
                }
              }, 5000);
            })();
          </script>
        `;

        return html.replace("<head>", `<head>${debugScript}`);
      },
    },
  };
}

const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];

export default defineConfig({
  plugins,
  // ============================================================================
  // 환경 변수 설정
  // ============================================================================
  // envPrefix: VITE_로 시작하는 환경 변수만 클라이언트에 노출
  // 기본값이 VITE_이므로 명시적으로 설정하여 명확성 확보
  envPrefix: 'VITE_',
  
  // define: HTML 템플릿에서 %VITE_*% 형식으로 사용할 환경 변수 정의
  // Vite가 빌드 시 이 값들을 치환함
  define: {
    __VITE_ANALYTICS_ENDPOINT__: JSON.stringify(process.env.VITE_ANALYTICS_ENDPOINT || ''),
    __VITE_ANALYTICS_WEBSITE_ID__: JSON.stringify(process.env.VITE_ANALYTICS_WEBSITE_ID || ''),
    __VITE_APP_ID__: JSON.stringify(process.env.VITE_APP_ID || ''),
    __VITE_OAUTH_PORTAL_URL__: JSON.stringify(process.env.VITE_OAUTH_PORTAL_URL || 'https://auth.manus.im'),
  },

  resolve: {
    alias: {
      "@": path.resolve(CLIENT_DIR || '.', "src"),
      "@shared": path.resolve(SHARED_DIR || '.'),
      "@assets": path.resolve(ASSETS_DIR || '.'),
    },
  },
  envDir: path.resolve(PROJECT_ROOT || '.'),
  root: path.resolve(CLIENT_DIR || '.'),
  publicDir: path.resolve(CLIENT_DIR || '.', "public"),
  build: {
    outDir: path.resolve(DIST_DIR || '.'),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});

// 디버그: 설정 값 로깅 (개발 환경에서만)
if (NODE_ENV === 'development') {
  console.log('[Vite Config] PROJECT_ROOT:', PROJECT_ROOT);
  console.log('[Vite Config] CLIENT_DIR:', CLIENT_DIR);
  console.log('[Vite Config] DIST_DIR:', DIST_DIR);
  console.log('[Vite Config] VITE_APP_ID:', process.env.VITE_APP_ID ? '***' : 'NOT SET');
  console.log('[Vite Config] VITE_OAUTH_PORTAL_URL:', process.env.VITE_OAUTH_PORTAL_URL || 'NOT SET');
  console.log('[Vite Config] VITE_ANALYTICS_ENDPOINT:', process.env.VITE_ANALYTICS_ENDPOINT || 'NOT SET');
}
