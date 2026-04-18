import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { initializeSeedData } from "../jobs/initSeed";
import { runSyncJob } from "../jobs/syncMonitor";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // 초기 Seed 데이터 로드 (비동기, 에러는 무시)
  await initializeSeedData({
    targetCount: 20,
    fixedRuleName: '전기안전관리자의 직무에 관한 고시',
  });

  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`\n✅ Server running on http://localhost:${port}/\n`);

    const delayRaw = process.env.LAW_SYNC_START_DELAY_MS;
    const delayMs =
      delayRaw != null && delayRaw !== ""
        ? Math.max(0, parseInt(delayRaw, 10) || 0)
        : 2500;

    const startSync = () => {
      console.log("[Server] 🚀 Starting monitoring sync job...");
      runSyncJob().catch((error) => {
        console.error("[Server] ⚠️  Sync job error (서버는 정상 실행):", error);
      });
    };

    if (delayMs <= 0) {
      startSync();
    } else {
      console.log(
        `[Server] Sync job starts in ${delayMs}ms (첫 법제처 요청 ECONNRESET 완화; LAW_SYNC_START_DELAY_MS=0 이면 즉시)`
      );
      setTimeout(startSync, delayMs);
    }
  });
}

startServer().catch(error => {
  console.error('[Server] ❌ Fatal error:', error);
  process.exit(1);
});
