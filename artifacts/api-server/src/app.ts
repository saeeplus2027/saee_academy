import express, { type Express } from "express";
import type { ErrorRequestHandler } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  const origin = req.get("origin");
  const requestHost = getClerkProxyHost(req)?.toLowerCase();
  if (!origin || !requestHost) {
    res.status(403).json({ error: "Request origin could not be verified." });
    return;
  }
  try {
    const originUrl = new URL(origin);
    const forwardedProtocol = req
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    const requestProtocol = forwardedProtocol || req.protocol;
    if (
      originUrl.host.toLowerCase() !== requestHost ||
      originUrl.protocol !== `${requestProtocol}:`
    ) {
      res.status(403).json({ error: "Cross-origin request rejected." });
      return;
    }
  } catch {
    res.status(403).json({ error: "Invalid request origin." });
    return;
  }
  next();
});

app.use("/api", router);

const safeErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  req.log.error({ err }, "Unhandled API error");
  res.status(500).json({ error: "An unexpected server error occurred." });
};
app.use(safeErrorHandler);

export default app;
