const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 8081);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const blankPlan = {
  monthsToCover: 7,
  bufferPct: 15,
  billsBalance: 0,
  essentialsBalance: 0,
  frostBalance: 0,
  fidelityBalance: 0,
  regularPaycheck: 0,
  regularChecks: 4,
  commissionAmount: 0,
  commissionFidelityPct: 60,
  lumpSum: 0,
  manualApproval: true,
  approvalThreshold: 500,
  readOnlyMode: true,
  fidelityManual: true,
  bills: [
    { id: "rent", name: "Rent", amount: 0, note: "Monthly housing need" },
    { id: "daycare", name: "Daycare", amount: 0, note: "Childcare continuity" },
    { id: "electric", name: "Electric", amount: 0, note: "Utility API or statement import" },
    { id: "gasUtility", name: "Gas utility", amount: 0, note: "Utility API or statement import" },
    { id: "water", name: "Water", amount: 0, note: "Utility API or statement import" },
    { id: "internet", name: "Internet/WiFi", amount: 0, note: "Provider bill import" },
    { id: "phone", name: "Phone", amount: 0, note: "Provider bill import" }
  ],
  variables: [
    { id: "groceries", name: "Groceries", amount: 0, note: "Pulled from transaction categories" },
    { id: "fuel", name: "Gas/Fuel", amount: 0, note: "Pulled from transaction categories" },
    { id: "pharmacy", name: "Pharmacy", amount: 0, note: "Pulled from transaction categories" }
  ],
  prepaid: [
    { id: "themeParks", name: "Theme parks", value: 0, covered: false },
    { id: "museums", name: "Museums", value: 0, covered: false },
    { id: "subscriptions", name: "Annual subscriptions", value: 0, covered: false },
    { id: "localActivities", name: "Local activities", value: 0, covered: false }
  ],
  spending: [
    { id: "takeout", name: "Takeout", amount: 0 },
    { id: "entertainment", name: "Entertainment", amount: 0 },
    { id: "shopping", name: "Shopping", amount: 0 },
    { id: "coffee", name: "Coffee", amount: 0 },
    { id: "kids", name: "Kids extras", amount: 0 },
    { id: "medical", name: "Medical", amount: 0 },
    { id: "home", name: "Home supplies", amount: 0 },
    { id: "misc", name: "Misc", amount: 0 }
  ]
};

function defaultConnectors() {
  return [
    {
      id: "bank_transactions",
      name: "Bank transactions",
      provider: "Plaid or direct bank API",
      status: "not_configured",
      purpose: "Pull deposits, bills, groceries, fuel, subscriptions, and balances.",
      requiredEnv: ["BANK_DATA_PROVIDER", "PLAID_CLIENT_ID", "PLAID_SECRET"]
    },
    {
      id: "bill_accounts",
      name: "Bill accounts",
      provider: "Utility/provider APIs",
      status: "not_configured",
      purpose: "Pull electric, water, gas, internet/WiFi, and phone statements.",
      requiredEnv: ["UTILITY_PROVIDER_CONFIG"]
    },
    {
      id: "fidelity",
      name: "Fidelity",
      provider: "Fidelity account workflow",
      status: "manual_required",
      purpose: "Track balances and recommendations. Trading remains manual until official support is confirmed.",
      requiredEnv: ["FIDELITY_MODE"]
    },
    {
      id: "alerts",
      name: "Alerts",
      provider: "Email/SMS/Slack",
      status: "not_configured",
      purpose: "Send warnings for funding gaps, anomalies, and upcoming renewals.",
      requiredEnv: ["ALERT_PROVIDER"]
    }
  ];
}

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(DB_FILE)) {
    writeDb({ users: [], sessions: {}, audit: [], plan: blankPlan, connectors: defaultConnectors() });
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function safeCompare(a, b) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cookie(req, name) {
  const header = req.headers.cookie || "";
  return header
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];
}

function makeSession(db, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[token] = {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  return token;
}

function getUser(req, db) {
  const token = cookie(req, "autonomy_session");
  if (!token || !db.sessions[token]) return null;
  const session = db.sessions[token];
  if (session.expiresAt < Date.now()) {
    delete db.sessions[token];
    writeDb(db);
    return null;
  }
  return db.users.find((user) => user.id === session.userId) || null;
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `autonomy_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "autonomy_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
}

function audit(db, user, action, details = {}) {
  db.audit.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    userId: user?.id || null,
    action,
    details
  });
  db.audit = db.audit.slice(0, 500);
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
}

function configuredConnectors(db) {
  return db.connectors.map((connector) => {
    const hasRequiredEnv =
      connector.requiredEnv.length > 0 &&
      connector.requiredEnv.every((key) => Boolean(process.env[key]));
    let status = connector.status;
    if (connector.id !== "fidelity" && hasRequiredEnv) status = "configured";
    return { ...connector, status, hasRequiredEnv };
  });
}

async function handleApi(req, res) {
  const db = readDb();
  const user = getUser(req, db);

  try {
    if (req.url === "/api/session" && req.method === "GET") {
      return json(res, 200, {
        user: publicUser(user),
        setupRequired: db.users.length === 0
      });
    }

    if (req.url === "/api/setup" && req.method === "POST") {
      if (db.users.length > 0) return json(res, 409, { error: "Owner account already exists." });
      const body = await parseBody(req);
      if (!body.email || !body.password || body.password.length < 12) {
        return json(res, 400, { error: "Use an email and a password of at least 12 characters." });
      }
      const password = hashPassword(body.password);
      const owner = {
        id: crypto.randomUUID(),
        email: String(body.email).toLowerCase(),
        role: "owner",
        password,
        createdAt: new Date().toISOString()
      };
      db.users.push(owner);
      audit(db, owner, "owner_created");
      const token = makeSession(db, owner.id);
      writeDb(db);
      setSessionCookie(res, token);
      return json(res, 201, { user: publicUser(owner) });
    }

    if (req.url === "/api/login" && req.method === "POST") {
      const body = await parseBody(req);
      const found = db.users.find((item) => item.email === String(body.email || "").toLowerCase());
      if (!found) return json(res, 401, { error: "Invalid login." });
      const test = hashPassword(body.password || "", found.password.salt);
      if (!safeCompare(test.hash, found.password.hash)) return json(res, 401, { error: "Invalid login." });
      audit(db, found, "login");
      const token = makeSession(db, found.id);
      writeDb(db);
      setSessionCookie(res, token);
      return json(res, 200, { user: publicUser(found) });
    }

    if (req.url === "/api/logout" && req.method === "POST") {
      const token = cookie(req, "autonomy_session");
      if (token) delete db.sessions[token];
      if (user) audit(db, user, "logout");
      writeDb(db);
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    if (!user) return json(res, 401, { error: "Login required." });

    if (req.url === "/api/plan" && req.method === "GET") {
      return json(res, 200, { plan: db.plan, user: publicUser(user) });
    }

    if (req.url === "/api/plan" && req.method === "PUT") {
      const body = await parseBody(req);
      db.plan = body.plan || db.plan;
      audit(db, user, "plan_saved");
      writeDb(db);
      return json(res, 200, { plan: db.plan });
    }

    if (req.url === "/api/connectors" && req.method === "GET") {
      return json(res, 200, { connectors: configuredConnectors(db) });
    }

    if (req.url === "/api/audit" && req.method === "GET") {
      if (user.role !== "owner") return json(res, 403, { error: "Owner access required." });
      return json(res, 200, { audit: db.audit.slice(0, 100) });
    }

    return json(res, 404, { error: "Not found." });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
}

function serveStatic(req, res) {
  let requested = decodeURIComponent(req.url.split("?")[0]);
  if (requested === "/") requested = "/index.html";
  const target = path.normalize(path.join(ROOT, requested));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(target);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=60"
    });
    res.end(data);
  });
}

ensureDb();

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/")) return handleApi(req, res);
    return serveStatic(req, res);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`AUTONOMY listening at http://127.0.0.1:${PORT}`);
  });
