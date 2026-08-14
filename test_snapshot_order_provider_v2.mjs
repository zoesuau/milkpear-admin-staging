import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { gzipSync, gunzipSync } from "node:zlib";
import { webcrypto } from "node:crypto";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const config = readFileSync(
  new URL("./customer-config.js", import.meta.url),
  "utf8",
);
const stableHtml = execFileSync(
  "git",
  ["show", "c8257bc:index.html"],
  { cwd: new URL(".", import.meta.url), encoding: "utf8" },
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const authStart = "      function clearAdminAuthSession()";
const authEnd = "      function switchAdminTab(";
assert.equal(
  sourceBetween(html, authStart, authEnd),
  sourceBetween(stableHtml, authStart, authEnd),
  "LINE Login source must remain byte-for-byte identical to c8257bc",
);

assert.match(config, /"environment": "staging"/);
assert.match(config, /PASTE_STAGING_GAS_WEB_APP_URL/);
assert.match(config, /PASTE_STAGING_ADMIN_SITE_URL/);
assert.match(html, /SNAPSHOT_STAGING_IDENTITY_REQUIRED/);

const fetchSource = sourceBetween(
  html,
  "      async function fetchAdminOrdersFromGas(options = {})",
  "      async function loadAdminOrdersForCurrentView(options = {})",
);
assert.match(fetchSource, /action: "adminReadOrderSnapshot"/);
assert.doesNotMatch(
  fetchSource,
  /action: "adminReadOrders"/,
  "snapshot candidate must not fall back to live Google Sheets reads",
);
assert.match(fetchSource, /if \(adminOrderSnapshotFetchPromise\)/);
assert.match(fetchSource, /ADMIN_ORDER_SNAPSHOT_MAX_RETRIES \+ 1/);
assert.match(fetchSource, /LINE 登入狀態未受影響/);

const initializationSource = sourceBetween(
  html,
  '      window.addEventListener("DOMContentLoaded", async () => {',
  "      // ==========================================\n      // ✨ 系統一",
);
assert.doesNotMatch(
  initializationSource,
  /handleShippingManifestRangeChange\(\);/,
  "orders home must not preload shipping or EZcat candidates",
);
assert.match(
  sourceBetween(html, "      function switchAdminTab(", "      function setShippingBatchManagementFeedback("),
  /tabName === "shippingPrint"[\s\S]*?loadCompleteShippingManifestOrders\(\)/,
  "shipping candidates must still load on demand when opening the print tab",
);

const authContext = {
  ADMIN_LINE_STATE_KEY: "state",
  ADMIN_LINE_NONCE_KEY: "nonce",
  ADMIN_LINE_CODE_VERIFIER_KEY: "verifier",
  ADMIN_LINE_SESSION_TOKEN_KEY: "session",
  ADMIN_DISPLAY_NAME_KEY: "display",
  ADMIN_AUTH_REDIRECT_URI: "https://staging.example.test/admin",
  ADMIN_AUTH_TIMEOUT_MS: 60000,
  GAS_ORDERS_API_URL: "https://staging.example.test/gas",
  LINE_LOGIN_CHANNEL_ID: "2010484376",
  TextEncoder,
  URL,
  URLSearchParams,
  btoa,
  crypto: webcrypto,
  currentAdminName: "後台管理員",
  assignedUrl: "",
  overlayMessages: [],
  sessionStorage: new (class {
    values = new Map();
    getItem(key) {
      return this.values.get(key) || null;
    }
    setItem(key, value) {
      this.values.set(key, String(value));
    }
    removeItem(key) {
      this.values.delete(key);
    }
  })(),
  window: {
    location: {
      search: "",
      origin: "https://staging.example.test",
      pathname: "/admin",
      hash: "",
      assign(url) {
        authContext.assignedUrl = String(url);
      },
    },
  },
  history: { replaceState() {} },
  document: {
    title: "staging",
    getElementById() {
      return null;
    },
  },
  showAdminAuthOverlay(message) {
    authContext.overlayMessages.push(String(message));
  },
  fetchWithTimeout() {
    throw new Error("no-session auth must not call GAS");
  },
};
vm.createContext(authContext);
vm.runInContext(
  `${sourceBetween(html, authStart, authEnd)}\nthis.init = initAdminAuth;`,
  authContext,
);
const authStartedAt = Date.now();
assert.equal(await authContext.init(), false);
assert.ok(Date.now() - authStartedAt < 1000, "no-session redirect must be prompt");
const lineAuthorizeUrl = new URL(authContext.assignedUrl);
assert.equal(lineAuthorizeUrl.origin, "https://access.line.me");
assert.equal(lineAuthorizeUrl.pathname, "/oauth2/v2.1/authorize");
assert.equal(lineAuthorizeUrl.searchParams.get("client_id"), "2010484376");
assert.equal(
  lineAuthorizeUrl.searchParams.get("redirect_uri"),
  "https://staging.example.test/admin",
);

const helperSource = sourceBetween(
  html,
  "      function createAdminDiagnosticRequestId(action)",
  "      function getAdminCreatePayloadFingerprint(payload)",
);
const providerSource = sourceBetween(
  html,
  "      function getAdminOrderSnapshotKnownChunks()",
  "      async function loadAdminOrdersForCurrentView(options = {})",
);

function gzipBase64(value) {
  return gzipSync(JSON.stringify(value)).toString("base64");
}

function makeProviderHarness(responseFactories, options = {}) {
  const responses = responseFactories.slice();
  const status = { className: "", innerText: "" };
  const messages = [];
  const storage = new Map([["session", options.session ?? "valid-session"]]);
  const context = {
    AbortController,
    Map,
    Promise,
    Uint8Array,
    JSON,
    Math,
    Date,
    atob,
    performance,
    crypto: webcrypto,
    ADMIN_ORDER_SNAPSHOT_MAX_RETRIES: 1,
    ADMIN_ORDER_SNAPSHOT_RETRY_DELAY_MS: 0,
    ADMIN_ORDER_SNAPSHOT_TIMEOUT_MS: 8000,
    ADMIN_LINE_SESSION_TOKEN_KEY: "session",
    ADMIN_DISPLAY_NAME_KEY: "display",
    ADMIN_ORDERS_PER_PAGE: 20,
    GAS_ORDERS_API_URL: "https://staging.example.test/gas",
    currentAdminName: "後台管理員",
    adminOrderSnapshotFetchPromise: null,
    adminOrderSnapshotVersion: "",
    adminOrderSnapshotManifest: [],
    adminOrderSnapshotSource: "",
    adminLastOrderReadDiagnostic: null,
    adminOrderSnapshotChunks: new Map(),
    latestAdminOrders: [],
    fetchCount: 0,
    messages,
    sessionStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    document: {
      documentElement: { dataset: {} },
      getElementById(id) {
        return id === "adminReadStatus" ? status : null;
      },
    },
    window: {
      setTimeout(callback) {
        callback();
        return 1;
      },
      getAdminOrderSnapshotDiagnostic: null,
    },
    setAdminStatusPanelVisible() {},
    showAdminAuthOverlay(message) {
      messages.push(String(message));
    },
    updateAdminRefreshMeta() {},
    createAdminRequestKey(action, parts) {
      return [action, ...parts].join("|");
    },
    async fetchWithTimeout() {
      context.fetchCount += 1;
      const factory = responses.shift();
      if (!factory) throw new Error("unexpected extra fetch");
      return factory();
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${helperSource}\n${providerSource}\nthis.read = fetchAdminOrdersFromGas;`,
    context,
  );
  context.decodeAdminSnapshotGzipJson = async (base64Data, timing = null) => {
    const startedAt = performance.now();
    const parsed = JSON.parse(
      gunzipSync(Buffer.from(base64Data, "base64")).toString("utf8"),
    );
    if (timing) {
      timing.decompressMs += Math.max(0, performance.now() - startedAt);
    }
    return parsed;
  };
  return context;
}

function jsonResponse(payload) {
  return () => ({ text: async () => JSON.stringify(payload) });
}

const driveOrders = [
  { orderNo: "TEST-2", createdAt: "2026/08/14 12:00:00" },
  { orderNo: "TEST-1", createdAt: "2026/08/14 11:00:00" },
];
const driveHarness = makeProviderHarness([
  jsonResponse({
    ok: true,
    action: "adminReadOrderSnapshot",
    source: "drive",
    stale: true,
    version: "drive-v1",
    data: gzipBase64({
      version: "drive-v1",
      orderCount: driveOrders.length,
      orders: driveOrders,
    }),
    elapsedMs: 321,
  }),
]);
const driveResult = await driveHarness.read();
assert.deepEqual(JSON.parse(JSON.stringify(driveResult)), driveOrders);
assert.equal(driveHarness.fetchCount, 1);
assert.equal(driveHarness.adminLastOrderReadDiagnostic.source, "drive");
assert.equal(driveHarness.adminLastOrderReadDiagnostic.stale, true);
assert.match(
  driveHarness.document.documentElement.dataset.snapshotDiagnostic,
  /"source":"drive"/,
);
assert.equal(
  driveHarness.messages.some((message) => message.includes("登入失敗")),
  false,
  "Drive success must never be surfaced as login failure",
);

const retryHarness = makeProviderHarness([
  jsonResponse({
    ok: false,
    action: "adminReadOrderSnapshot",
    error: "ADMIN_ORDER_SNAPSHOT_UNAVAILABLE",
  }),
  jsonResponse({
    ok: false,
    action: "adminReadOrderSnapshot",
    error: "ADMIN_ORDER_SNAPSHOT_UNAVAILABLE",
  }),
]);
assert.equal(await retryHarness.read(), null);
assert.equal(retryHarness.fetchCount, 2, "the whole read may retry only once");
assert.equal(retryHarness.adminLastOrderReadDiagnostic.attempts.length, 2);
assert.ok(
  retryHarness.messages.some((message) =>
    message.includes("LINE 登入狀態未受影響"),
  ),
);

let resolveSingleFlight;
const singleFlightHarness = makeProviderHarness([
  () => ({
    text: () =>
      new Promise((resolve) => {
        resolveSingleFlight = () =>
          resolve(
            JSON.stringify({
              ok: true,
              action: "adminReadOrderSnapshot",
              source: "drive",
              stale: true,
              version: "drive-v2",
              data: gzipBase64({ version: "drive-v2", orderCount: 0, orders: [] }),
            }),
          );
      }),
  }),
]);
const firstRead = singleFlightHarness.read();
const secondRead = singleFlightHarness.read();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(singleFlightHarness.fetchCount, 1);
resolveSingleFlight();
await Promise.all([firstRead, secondRead]);
assert.equal(singleFlightHarness.fetchCount, 1, "concurrent reads must be single-flight");

const noSessionHarness = makeProviderHarness([], { session: "" });
assert.equal(await noSessionHarness.read(), null);
assert.equal(noSessionHarness.fetchCount, 0);
assert.ok(
  noSessionHarness.messages.some((message) => message.includes("登入已過期")),
);

for (const [startMarker, endMarker] of [
  ["      function filterByStatus(", "      function filterByDateRange("],
  ["      function filterByDateRange(", "      function handleCustomDateRangeChange("],
  ["      function filterByNotificationMode(", "      function getAdminFilterCardDate("],
]) {
  const localFilterSource = sourceBetween(html, startMarker, endMarker);
  assert.doesNotMatch(
    localFilterSource,
    /fetch\(|fetchAdminOrdersFromGas|adminReadOrderSnapshot|adminReadOrders/,
    `${startMarker.trim()} must remain browser-local`,
  );
}

console.log("snapshot order provider v2 regression checks passed");
