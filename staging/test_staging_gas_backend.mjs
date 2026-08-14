import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const source = readFileSync(new URL("./Code.gs", import.meta.url), "utf8");
const manifest = JSON.parse(
  readFileSync(new URL("./appsscript.json", import.meta.url), "utf8"),
);

assert.doesNotThrow(() => new Function(source));
assert.match(source, /adminOrderSnapshots\/sanheyuan-staging/);
assert.doesNotMatch(source, /adminOrderSnapshots\/sanheyuan-production/);
assert.doesNotMatch(source, /getSystemSpreadsheet_|SpreadsheetApp/);
assert.doesNotMatch(source, /LINE_LOGIN_CHANNEL_SECRET\s*:\s*["'][^"']{10}/);
assert.doesNotMatch(source, /LINE_ADMIN_ALLOWED_USER_IDS\s*:\s*["']U[0-9a-f]{32}/i);
assert.match(source, /postData\.action === "adminAuth"/);
assert.match(source, /postData\.action === "adminValidateSession"/);
assert.match(source, /postData\.action === "adminReadOrderSnapshot"/);
assert.match(source, /postData\.action === "adminReadProductCatalog"/);
assert.doesNotMatch(source, /adminCreateOrder|adminUpdateOrder|adminMarkOrderShipped/);
assert.match(source, /STAGING_FORCE_FIRESTORE_FAILURE/);
assert.match(source, /source: "drive"/);
assert.match(source, /documents:batchGet/);
assert.doesNotMatch(source, /UrlFetchApp\.fetchAll/);

const context = { console };
vm.createContext(context);
vm.runInContext(source, context);
const orders = context.stagingBuildSyntheticOrders_();
assert.equal(orders.length, 376);
assert.equal(orders[0].orderNo, "STAGING-0001");
assert.equal(orders.at(-1).orderNo, "STAGING-0376");
assert.equal(new Set(orders.map((order) => order.orderNo)).size, 376);
assert.equal(
  orders.every((order) =>
    String(order.recipientName).startsWith("去識別化收件人"),
  ),
  true,
);

context.Utilities = {
  newBlob(value) {
    return { value: String(value) };
  },
  gzip(blob) {
    const bytes = gzipSync(blob.value);
    return {
      getBytes: () =>
        Array.from(bytes, (byte) => (byte > 127 ? byte - 256 : byte)),
    };
  },
  base64Encode(bytes) {
    return Buffer.from(bytes.map((byte) => (byte < 0 ? byte + 256 : byte)))
      .toString("base64");
  },
};
const originalChunkLimit =
  context.STAGING_SNAPSHOT_MAX_COMPRESSED_BYTES_PER_CHUNK_;
const oneChunkPlan = context.stagingBuildSnapshotPlan_(orders, "test-version");
assert.equal(oneChunkPlan.bucketCount, 1);
assert.equal(oneChunkPlan.buckets[0].length, 376);
assert.equal(oneChunkPlan.encodedBuckets.length, 1);

let mutationOrders = orders;
for (const scenario of [
  "add",
  "edit",
  "payment",
  "schedule",
  "cancel",
  "shipped",
  "notification",
]) {
  mutationOrders = context.stagingApplySyntheticMutationScenario_(
    mutationOrders,
    scenario,
  );
}
assert.equal(mutationOrders.length, 377);
assert.equal(
  context.stagingFindSyntheticOrderIndex_(
    mutationOrders,
    "STAGING-MUTATION-NEW",
  ) >= 0,
  true,
);
assert.deepEqual(
  {
    recipientName: mutationOrders[0].recipientName,
    finalAmount: mutationOrders[0].finalAmount,
    paymentState: mutationOrders[0].paymentState,
    expectedShippingDate: mutationOrders[0].expectedShippingDate,
  },
  {
    recipientName: "測試修改收件人",
    finalAmount: 4321,
    paymentState: "bank_paid",
    expectedShippingDate: "2026/08/29",
  },
);
assert.equal(mutationOrders[1].orderStatus, "已取消");
assert.deepEqual(
  {
    orderStatus: mutationOrders[2].orderStatus,
    actualShippingDate: mutationOrders[2].actualShippingDate,
    trackingNo: mutationOrders[2].trackingNo,
    notificationStatus: mutationOrders[2].notificationStatus,
    lastNotificationType: mutationOrders[2].lastNotificationType,
  },
  {
    orderStatus: "已寄出",
    actualShippingDate: "2026/08/30",
    trackingNo: "STAGING123456789",
    notificationStatus: "sent",
    lastNotificationType: "shipment_notice",
  },
);
assert.throws(
  () =>
    context.stagingApplySyntheticMutationScenario_(
      mutationOrders,
      "unsupported",
    ),
  /STAGING_MUTATION_SCENARIO_INVALID/,
);

context.STAGING_SNAPSHOT_MAX_COMPRESSED_BYTES_PER_CHUNK_ = 7000;
const twoChunkPlan = context.stagingBuildSnapshotPlan_(orders, "test-version");
assert.equal(twoChunkPlan.bucketCount, 2);
assert.equal(
  twoChunkPlan.buckets.reduce((sum, bucket) => sum + bucket.length, 0),
  376,
);

context.STAGING_SNAPSHOT_MAX_COMPRESSED_BYTES_PER_CHUNK_ = 4000;
const fourChunkPlan = context.stagingBuildSnapshotPlan_(orders, "test-version");
assert.equal(fourChunkPlan.bucketCount, 4);
assert.equal(
  fourChunkPlan.buckets.reduce((sum, bucket) => sum + bucket.length, 0),
  376,
);

context.STAGING_SNAPSHOT_MAX_COMPRESSED_BYTES_PER_CHUNK_ = 1;
assert.throws(
  () => context.stagingBuildSnapshotPlan_(orders, "test-version"),
  /STAGING_SNAPSHOT_EXCEEDS_FOUR_CHUNKS/,
);
context.STAGING_SNAPSHOT_MAX_COMPRESSED_BYTES_PER_CHUNK_ = originalChunkLimit;

let capturedBatchRequest = null;
context.stagingFirestoreBaseUrl_ = () =>
  "https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents";
context.ScriptApp = { getOAuthToken: () => "test-token" };
context.UrlFetchApp = {
  fetch(url, options) {
    capturedBatchRequest = { url, options };
    const requestedNames = JSON.parse(options.payload).documents;
    return {
      getResponseCode: () => 200,
      getContentText: () =>
        JSON.stringify(
          requestedNames
            .slice()
            .reverse()
            .map((name, index) => ({
              found: {
                name,
                fields: {
                  payload: { bytesValue: `payload-${index}` },
                  checksum: {
                    stringValue: name.endsWith("b000-s0")
                      ? "checksum-0"
                      : "checksum-1",
                  },
                },
              },
            })),
        ),
    };
  },
};
const batchEntries = [
  {
    bucketId: 0,
    path: "adminOrderSnapshots/sanheyuan-staging/chunks/b000-s0",
    checksum: "checksum-0",
    orderCount: 12,
    compressedBytes: 100,
  },
  {
    bucketId: 1,
    path: "adminOrderSnapshots/sanheyuan-staging/chunks/b001-s0",
    checksum: "checksum-1",
    orderCount: 11,
    compressedBytes: 90,
  },
];
const batchChunks = context.stagingReadChunks_(batchEntries);
assert.equal(capturedBatchRequest.options.method, "post");
assert.equal(
  capturedBatchRequest.url,
  "https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents:batchGet",
);
assert.equal(
  JSON.parse(capturedBatchRequest.options.payload).documents.length,
  2,
);
assert.deepEqual(
  batchChunks.map((chunk) => chunk.bucketId),
  [0, 1],
  "batchGet responses must be restored to manifest order",
);

assert.deepEqual(manifest.oauthScopes.sort(), [
  "https://www.googleapis.com/auth/datastore",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/script.external_request",
]);

console.log(
  "staging GAS backend regression checks passed " +
    "(376 synthetic orders, dynamic 1/2/4 chunks, batchGet)",
);
