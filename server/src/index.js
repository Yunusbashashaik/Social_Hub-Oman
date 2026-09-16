import cors from "cors";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { getDataDir, getUploadsDir, initDatabase } from "./db/connection.js";
import { seedDatabase } from "./db/seed.js";
import { getHealthPayload } from "./health.js";
import { adminRouter } from "./routes/admin.js";
import { complaintRouter } from "./routes/complaints.js";
import { servicesRouter } from "./routes/services.js";
import { settingsRouter } from "./routes/settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || "0.0.0.0";

// Production boot (app.js → index.js):
// 1) initDatabase: resolveDataDir (DATA_DIR env or /root then $HOME then /local),
//    copy a surviving replica if the primary dir is empty, open SQLite/JSON.
// 2) seed.js bindPersist (module load) then seedDatabase: hydrate the best
//    custom snapshot, factory-seed only on true first boot, persistAdminState
//    to every replica path without clobbering a custom admin-state.json.
initDatabase();
seedDatabase();
console.log(`Admin data directory: ${getDataDir()}`);

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json(getHealthPayload());
});

app.use("/api/uploads", express.static(getUploadsDir()));
app.use("/api/services", servicesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/complaints", complaintRouter);

const clientDist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

export function startServer() {
  if (process.env.NODE_ENV === "test") return;
  if (app.listening || startServer.started) return;
  startServer.started = true;

  const passengerGlobal = typeof globalThis.PhusionPassenger !== "undefined";
  const passengerEnv = Boolean(
    process.env.PASSENGER_APP_ENV || process.env.PASSENGER_SPAWN_WORK_DIR,
  );

  if (passengerGlobal) {
    globalThis.PhusionPassenger.configure({ autoInstall: false });
    app.listen("passenger");
    console.log("Social Hub - Oman API listening via Phusion Passenger");
    return;
  }

  app.listen(PORT, HOST, () => {
    console.log(
      `Social Hub - Oman API listening on http://${HOST}:${PORT}${passengerEnv ? " (Passenger env)" : ""}`,
    );
  });
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startServer();
}

export { app };
export default app;
