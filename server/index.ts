/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import Templates from "./lib/rfp-templates";
import { startEmailScheduler } from "./email-scheduler";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Apply urlencoded middleware only to non-multipart routes
app.use((req, res, next) => {
  if (req.path === '/api/rfp-requests' && req.method === 'POST') {
    // Skip urlencoded parsing for RFP creation route (handled by multer)
    next();
  } else {
    express.urlencoded({ extended: false })(req, res, next);
  }
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize RFP Templates module
  try {
    await Templates.init();
    log("✅ RFP Templates initialized successfully");
  } catch (error) {
    log(`⚠️  Warning: Failed to initialize RFP Templates: ${error}`);
  }

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Start the email scheduler for Mon/Wed/Fri 8 AM status reports
  try {
    startEmailScheduler();
    log("✅ Email scheduler started (Mon/Wed/Fri at 8 AM)");
  } catch (error) {
    log(`⚠️  Warning: Failed to start email scheduler: ${error}`);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });
})();
