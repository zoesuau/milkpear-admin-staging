import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const stagingDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(stagingDirectory, "..");
const host = "127.0.0.1";
const port = Math.max(
  1024,
  Number(process.argv[2]) || Number(process.env.STAGING_MOCK_PORT) || 4173,
);
const validSession = "mock-admin-session";
const bucketCount = 32;

let scenario = "firestore";
let requestDelayMs = 0;
let events = [];

function syntheticOrder(index) {
  const sequence = index + 1;
  return {
    orderNo: `STAGING-${String(sequence).padStart(4, "0")}`,
    createdAt: `2026/08/${String((index % 14) + 1).padStart(2, "0")} 12:00:00`,
    recipientName: `去識別化收件人${sequence}`,
    recipientPhone: `0900${String(sequence).padStart(6, "0")}`,
    recipientAddress: `測試縣測試路${sequence}號`,
    buyerName: `去識別化訂購人${sequence}`,
    buyerPhone: `0911${String(sequence).padStart(6, "0")}`,
    itemsSummary: `測試商品 ×${(index % 4) + 1}盒`,
    totalBoxes: (index % 4) + 1,
    shippingFee: 120,
    finalAmount: 1000 + (index % 9) * 100,
    paymentMethod: index % 2 ? "銀行轉帳" : "貨到付款",
    paymentStatus: index % 2 ? "已付款" : "未付款",
    paymentState: index % 2 ? "bank_paid" : "cod",
    expectedShippingDate: `2026/08/${String((index % 14) + 15).padStart(2, "0")}`,
    actualShippingDate: index % 4 === 2 ? "2026/08/28" : "",
    orderStatus: ["待確認", "已安排出貨", "已寄出", "已取消"][index % 4],
    orderSource: index % 2 ? "LINE客戶訂單" : "管理員新增的訂單",
    canLineNotify: index % 2 === 1,
    notificationStatus: index % 2 ? "sent" : "manual_required",
    customerNote: index % 7 === 0 ? "去識別化測試備註" : "",
    adminNote: "",
    lastUpdatedAt: "2026/08/14 12:00:00",
    lastUpdatedBy: "staging-admin",
  };
}

const orders = Array.from({ length: 376 }, (_, index) => syntheticOrder(index));
const buckets = Array.from({ length: bucketCount }, () => []);
orders.forEach((order, index) => buckets[index % bucketCount].push(order));
const chunks = buckets.map((bucketOrders, bucketId) => {
  const payload = gzipSync(
    JSON.stringify({ schemaVersion: 1, bucketId, orders: bucketOrders }),
  );
  return {
    bucketId,
    checksum: `mock-checksum-${bucketId}`,
    encoding: "gzip-base64",
    data: payload.toString("base64"),
    orderCount: bucketOrders.length,
    compressedBytes: payload.length,
  };
});
const manifest = chunks.map(
  ({ bucketId, checksum, orderCount, compressedBytes }) => ({
    bucketId,
    checksum,
    orderCount,
    compressedBytes,
  }),
);
const drivePayload = gzipSync(
  JSON.stringify({ version: "mock-drive-v1", orderCount: orders.length, orders }),
).toString("base64");

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(body);
}

function sendJson(response, payload) {
  send(response, 200, "application/json; charset=utf-8", JSON.stringify(payload));
}

async function readJsonBody(request) {
  const parts = [];
  for await (const part of request) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
}

function stagingConfig() {
  return `window.ORDER_SYSTEM_CONFIG = Object.freeze(${JSON.stringify(
    {
      productId: "farm-order-fulfillment",
      customerId: "sanheyuan",
      environment: "staging",
      brandName: "三合院農園 STAGING",
      publicSiteTitle: "三合院農園訂購系統 STAGING",
      adminSiteTitle: "三合院農園出貨後台 STAGING",
      gasApiUrl: `http://${host}:${port}/api`,
      publicSiteUrl: `http://${host}:${port}/`,
      adminSiteUrl: `http://${host}:${port}/`,
      line: { liffId: "mock-liff", loginChannelId: "2010484376" },
      assets: { bannerImageUrl: "" },
    },
    null,
    2,
  )});`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (request.method === "GET" && url.pathname === "/__seed-session") {
    scenario = ["firestore", "drive", "unavailable"].includes(
      url.searchParams.get("scenario"),
    )
      ? url.searchParams.get("scenario")
      : "firestore";
    requestDelayMs = Math.max(
      0,
      Math.min(5000, Number(url.searchParams.get("delayMs")) || 0),
    );
    events = [];
    return send(
      response,
      200,
      "text/html; charset=utf-8",
      `<!doctype html><meta charset="utf-8"><script>
        sessionStorage.setItem(
          "farm-order-fulfillment:sanheyuan:staging:admin-session-token",
          ${JSON.stringify(validSession)}
        );
        location.replace("/");
      </script>`,
    );
  }
  if (request.method === "GET" && url.pathname === "/") {
    return send(
      response,
      200,
      "text/html; charset=utf-8",
      readFileSync(resolve(projectDirectory, "index.html"), "utf8"),
    );
  }
  if (request.method === "GET" && url.pathname === "/customer-config.js") {
    return send(response, 200, "text/javascript; charset=utf-8", stagingConfig());
  }
  if (request.method === "GET" && url.pathname === "/events") {
    return send(
      response,
      200,
      "text/html; charset=utf-8",
      `<!doctype html><meta charset="utf-8"><pre id="events">${JSON.stringify({ scenario, requestDelayMs, events })}</pre>`,
    );
  }
  if (request.method === "GET" && url.pathname === "/control") {
    scenario = ["firestore", "drive", "unavailable"].includes(
      url.searchParams.get("scenario"),
    )
      ? url.searchParams.get("scenario")
      : scenario;
    requestDelayMs = Math.max(
      0,
      Math.min(5000, Number(url.searchParams.get("delayMs")) || 0),
    );
    if (url.searchParams.get("reset") === "true") events = [];
    return send(
      response,
      200,
      "text/html; charset=utf-8",
      `<!doctype html><meta charset="utf-8"><pre id="control">${JSON.stringify({ ok: true, scenario, requestDelayMs, eventCount: events.length })}</pre>`,
    );
  }
  if (request.method === "GET" && url.pathname === "/__state") {
    return sendJson(response, { scenario, requestDelayMs, events });
  }
  if (request.method === "POST" && url.pathname === "/__control") {
    const body = await readJsonBody(request);
    scenario = ["firestore", "drive", "unavailable"].includes(body.scenario)
      ? body.scenario
      : "firestore";
    requestDelayMs = Math.max(0, Math.min(5000, Number(body.delayMs) || 0));
    if (body.resetEvents !== false) events = [];
    return sendJson(response, { ok: true, scenario, requestDelayMs });
  }
  if (request.method === "POST" && url.pathname === "/api") {
    const body = await readJsonBody(request);
    events.push({ action: String(body.action || ""), at: Date.now() });
    if (requestDelayMs) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, requestDelayMs));
    }
    if (body.action === "adminReadProductCatalog") {
      return sendJson(response, {
        ok: true,
        action: "adminReadProductCatalog",
        products: [],
        catalogVersion: "mock-catalog-v1",
      });
    }
    if (body.action !== "adminReadOrderSnapshot") {
      return sendJson(response, { ok: false, error: "MOCK_ACTION_UNSUPPORTED" });
    }
    if (body.adminSessionToken !== validSession) {
      return sendJson(response, {
        ok: false,
        action: "adminReadOrderSnapshot",
        error: "ADMIN_SESSION_REQUIRED",
        requestId: body.requestId || "",
      });
    }
    if (scenario === "unavailable") {
      return sendJson(response, {
        ok: false,
        action: "adminReadOrderSnapshot",
        error: "ADMIN_ORDER_SNAPSHOT_UNAVAILABLE",
        requestId: body.requestId || "",
        elapsedMs: requestDelayMs,
      });
    }
    if (scenario === "drive") {
      return sendJson(response, {
        ok: true,
        action: "adminReadOrderSnapshot",
        source: "drive",
        stale: true,
        version: "mock-drive-v1",
        encoding: "gzip-base64",
        data: drivePayload,
        compressedBytes: Buffer.byteLength(drivePayload, "base64"),
        requestId: body.requestId || "",
        timing: {
          sessionMs: 1,
          manifestMs: 1,
          chunksMs: 0,
          firestoreMs: 2,
          driveMs: 1,
        },
        elapsedMs: requestDelayMs + 3,
      });
    }
    return sendJson(response, {
      ok: true,
      action: "adminReadOrderSnapshot",
      source: "firestore",
      stale: false,
      version: "mock-firestore-v1",
      schemaVersion: 1,
      orderCount: orders.length,
      bucketCount,
      chunks,
      manifest,
      requestId: body.requestId || "",
      timing: {
        sessionMs: 1,
        manifestMs: 1,
        chunksMs: 2,
        firestoreMs: 3,
        driveMs: 0,
      },
      elapsedMs: requestDelayMs + 4,
    });
  }
  send(response, 404, "text/plain; charset=utf-8", "not found");
});

server.listen(port, host, () => {
  console.log(
    JSON.stringify({
      ok: true,
      url: `http://${host}:${port}/`,
      scenario,
      orderCount: orders.length,
      containsOrderData: false,
    }),
  );
});
