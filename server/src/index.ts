import cors from "cors";
import express from "express";
import pino from "pino-http";
import { imageRouter } from "./routes/imageRouter.js";

export const app = express();
app.disable("x-powered-by");
app.use(
  pino({
    level: process.env.LOG_LEVEL || "info",
    redact: ["req.headers.authorization", "req.headers.cookie"],
  })
);
const allowedOrigins = new Set(
  (
    process.env.CORS_ORIGINS ||
    "http://localhost:5173,http://127.0.0.1:5173,https://proxxied.com,https://www.proxxied.com"
  )
    .split(",")
    .map((s) => s.trim())
);
app.use(
  cors({
    origin: (origin, callback) =>
      callback(null, !origin || allowedOrigins.has(origin)),
    methods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400,
  })
);
app.use(express.json({ limit: "256kb" }));
app.use("/api/cards/images", imageRouter);
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});
app.use(
  (
    error: { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res
      .status(error.status || 500)
      .json({
        error:
          error.status === 413
            ? "Request is too large. Import a smaller list."
            : "Invalid request. Check the input and try again.",
      });
  }
);
const PORT = Number(process.env.PORT || 3001);
if (require.main === module) app.listen(PORT, "0.0.0.0");
