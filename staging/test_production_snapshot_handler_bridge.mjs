import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const productionGas = readFileSync(new URL("../../0707.gs", import.meta.url), "utf8");
const productionGasSha256 = createHash("sha256")
  .update(productionGas)
  .digest("hex");

function topLevelFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in the production GAS candidate`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

const handlerMappings = [
  ["adminCreateOrder", "handleAdminCreateOrderRequest_"],
  ["adminUpdateOrderContent", "handleAdminUpdateOrderContentRequest_"],
  ["adminUpdateOrderAdminNote", "handleAdminUpdateOrderAdminNoteRequest_"],
  ["adminUpdateOrderWorkflow", "handleAdminUpdateOrderWorkflowRequest_"],
  ["adminCancelOrder", "handleAdminCancelOrderRequest_"],
  ["adminUpdateActualShippingDate", "handleAdminUpdateActualShippingDateRequest_"],
  ["adminMarkOrderShipped", "handleAdminMarkOrderShippedRequest_"],
];

for (const [action, handlerName] of handlerMappings) {
  assert.match(
    productionGas,
    new RegExp(`postData\\.action === "${action}"[\\s\\S]*?${handlerName}`),
    `${action} must dispatch to ${handlerName}`,
  );
  assert.match(
    topLevelFunctionSource(productionGas, handlerName),
    /syncAdminOrderSnapshot(?:Response_|AfterMutation_)/,
    `${handlerName} success path must enter the snapshot bridge`,
  );
}

const pureStart = productionGas.indexOf("var ADMIN_ORDER_SNAPSHOT_SCHEMA_VERSION_");
const pureEnd = productionGas.indexOf("function getAdminOrderSnapshotConfig_", pureStart);
assert.notEqual(pureStart, -1);
assert.notEqual(pureEnd, -1);
const bridgeSource = [
  productionGas.slice(pureStart, pureEnd),
  topLevelFunctionSource(productionGas, "syncAdminOrderSnapshotAfterMutation_"),
  topLevelFunctionSource(productionGas, "flushAdminOrderSnapshotMutationQueue_"),
  topLevelFunctionSource(productionGas, "syncAdminOrderSnapshotResponse_"),
].join("\n");

assert.doesNotMatch(
  bridgeSource,
  /dispatchOrderNotification_|UrlFetchApp|LINE|pushMessage|MessagingApi/,
  "snapshot bridge regression must not invoke any notification transport",
);

function makePropertyStore(initial = {}) {
  const values = { ...initial };
  return {
    values,
    api: {
      setProperty(key, value) {
        values[key] = String(value);
      },
      getProperty(key) {
        return Object.prototype.hasOwnProperty.call(values, key)
          ? values[key]
          : null;
      },
      getProperties() {
        return { ...values };
      },
      deleteProperty(key) {
        delete values[key];
      },
    },
  };
}

function queueKeys(store) {
  return Object.keys(store.values).filter((key) =>
    key.startsWith("ADMIN_ORDER_SNAPSHOT_MUTATION_"),
  );
}

const propertyStore = makePropertyStore();
let snapshotEnabled = true;
let dirtyMarks = 0;
const context = {
  console: { log() {} },
  getAdminOrderSnapshotConfig_: () => ({ enabled: snapshotEnabled, bucketCount: 4 }),
  PropertiesService: { getScriptProperties: () => propertyStore.api },
  markAdminOrderSnapshotDriveDirty_: () => {
    dirtyMarks += 1;
  },
};
vm.createContext(context);
vm.runInContext(
  `${bridgeSource}\nthis.syncResponse = syncAdminOrderSnapshotResponse_; this.syncOne = syncAdminOrderSnapshotAfterMutation_; this.flushQueue = flushAdminOrderSnapshotMutationQueue_; this.bucketFor = getAdminOrderSnapshotBucketIndex_;`,
  context,
);

const mutationOrders = [
  {
    scenario: "add",
    orderNo: "BRIDGE-ADD-001",
    createdAt: "2026/08/14 15:00:00",
    orderStatus: "待確認",
    orderSource: "管理員新增的訂單",
  },
  {
    scenario: "edit",
    orderNo: "BRIDGE-EDIT-001",
    recipientName: "隔離修改收件人",
    recipientAddress: "隔離修改地址",
    itemsSummary: "隔離商品 ×2",
    finalAmount: 4321,
    adminNote: "隔離修改",
  },
  {
    scenario: "payment",
    orderNo: "BRIDGE-PAY-001",
    paymentMethod: "銀行轉帳",
    paymentState: "bank_paid",
    paymentStatus: "已付款",
  },
  {
    scenario: "schedule",
    orderNo: "BRIDGE-SCHEDULE-001",
    orderStatus: "已安排出貨",
    expectedShippingDate: "2026/08/29",
    requestedShippingBatchId: "STAGING-BATCH-0829",
    shippingDateNoticeMode: "line",
  },
  {
    scenario: "cancel",
    orderNo: "BRIDGE-CANCEL-001",
    orderStatus: "已取消",
    lastUpdatedBy: "隔離測試管理員",
  },
  {
    scenario: "shipped",
    orderNo: "BRIDGE-SHIPPED-001",
    orderStatus: "已寄出",
    actualShippingDate: "2026/08/30",
    trackingNo: "STAGING123456789",
    notificationStatus: "sent",
    lastNotificationType: "shipment_notice",
  },
];

for (const order of mutationOrders) {
  const payload = { ok: true, action: order.scenario, order: { ...order } };
  const result = context.syncResponse(payload);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.snapshotSync)),
    { ok: true, queued: true },
  );
}
assert.equal(queueKeys(propertyStore).length, mutationOrders.length);
assert.equal(dirtyMarks, mutationOrders.length);

const forbiddenOrder = {
  orderNo: "BRIDGE-FORBIDDEN-001",
  paymentState: "bank_paid",
  internalToken: "must-not-enter-snapshot",
  notificationHistory: [{ secret: true }],
};
context.syncOne(forbiddenOrder);
const forbiddenQueueKey = queueKeys(propertyStore).find((key) =>
  key.includes("BRIDGE-FORBIDDEN-001"),
);
const queuedForbidden = JSON.parse(propertyStore.values[forbiddenQueueKey]);
assert.equal(queuedForbidden.orderNo, forbiddenOrder.orderNo);
assert.equal("internalToken" in queuedForbidden, false);
assert.equal("notificationHistory" in queuedForbidden, false);

const paymentQueueKey = queueKeys(propertyStore).find((key) =>
  key.includes("BRIDGE-PAY-001"),
);
context.syncOne({
  ...mutationOrders[2],
  paymentState: "bank_unpaid",
  paymentStatus: "未付款",
});
assert.equal(queueKeys(propertyStore).length, mutationOrders.length + 1);
assert.equal(
  JSON.parse(propertyStore.values[paymentQueueKey]).paymentState,
  "bank_unpaid",
  "repeated updates for one order must overwrite the same queue key",
);

const untouched = { ok: false, order: mutationOrders[0] };
assert.equal(context.syncResponse(untouched), untouched);
snapshotEnabled = false;
const disabledCount = queueKeys(propertyStore).length;
assert.deepEqual(
  JSON.parse(JSON.stringify(context.syncOne({ orderNo: "DISABLED-001" }))),
  { ok: false, skipped: true },
);
assert.equal(queueKeys(propertyStore).length, disabledCount);
snapshotEnabled = true;

const existingOrders = mutationOrders.slice(0, 5).map((order) => ({
  orderNo: order.orderNo,
  createdAt: "2026/08/13 12:00:00",
  orderStatus: "舊狀態",
}));
const existingByBucket = { 0: [], 1: [], 2: [], 3: [] };
for (const order of existingOrders) {
  existingByBucket[context.bucketFor(order.orderNo, 4)].push(order);
}
const originalChunks = [0, 1, 2, 3].map((bucketId) => ({
  bucketId,
  slot: 0,
  path: `old-${bucketId}`,
  checksum: `old-checksum-${bucketId}`,
  compressedBytes: 100,
  orderCount: existingByBucket[bucketId].length,
}));
let capturedPrepared = [];
let capturedManifest = null;
let manifestShouldFail = false;
context.LockService = {
  getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }),
};
context.readAdminOrderSnapshotManifestFromFirestore_ = () => ({
  schemaVersion: 1,
  version: "old-version",
  orderCount: existingOrders.length,
  bucketCount: 4,
  compressedBytes: 400,
  chunks: originalChunks.map((entry) => ({ ...entry })),
});
context.readAdminOrderSnapshotChunksFromFirestore_ = (entries) =>
  entries.map((entry) => ({
    bucketId: entry.bucketId,
    data: String(entry.bucketId),
  }));
context.decodeAdminOrderSnapshotPayload_ = (data) => ({
  orders: existingByBucket[Number(data)].map((order) => ({ ...order })),
});
context.createAdminOrderSnapshotVersion_ = () => "bridge-version-2";
context.prepareAdminOrderSnapshotChunk_ = (
  config,
  version,
  bucketId,
  slot,
  orders,
) => ({
  entry: {
    bucketId,
    slot,
    path: `new-${bucketId}`,
    checksum: `new-checksum-${bucketId}`,
    compressedBytes: 200 + orders.length,
    orderCount: orders.length,
  },
  orders: orders.map((order) => ({ ...order })),
});
context.writePreparedAdminOrderSnapshotChunks_ = (config, prepared) => {
  capturedPrepared = prepared;
  return prepared.map((item) => ({ ...item.entry }));
};
context.writeAdminOrderSnapshotManifest_ = (config, manifest) => {
  if (manifestShouldFail) throw new Error("FORCED_MANIFEST_FAILURE");
  capturedManifest = manifest;
};

const queuedBeforeFlush = queueKeys(propertyStore).length;
const flushResult = context.flushQueue();
assert.equal(flushResult.ok, true);
assert.equal(flushResult.count, queuedBeforeFlush);
assert.equal(queueKeys(propertyStore).length, 0);
assert.ok(capturedPrepared.length >= 1 && capturedPrepared.length <= 4);
assert.equal(capturedManifest.orderCount, existingOrders.length + 2);
assert.equal(capturedManifest.chunks.length, 4);
const writtenOrders = capturedPrepared.flatMap((item) => item.orders);
for (const queued of [...mutationOrders, forbiddenOrder]) {
  const actual = writtenOrders.find((order) => order.orderNo === queued.orderNo);
  assert.ok(actual, `${queued.orderNo} must be present after queue flush`);
}
assert.equal(
  writtenOrders.find((order) => order.orderNo === "BRIDGE-PAY-001")
    .paymentState,
  "bank_unpaid",
);

context.syncOne({
  orderNo: "BRIDGE-RETRY-001",
  orderStatus: "已取消",
  createdAt: "2026/08/14 16:00:00",
});
const retryKey = queueKeys(propertyStore)[0];
manifestShouldFail = true;
const failedFlush = context.flushQueue();
assert.equal(failedFlush.ok, false);
assert.equal(failedFlush.error, "SNAPSHOT_FLUSH_FAILED");
assert.ok(
  Object.prototype.hasOwnProperty.call(propertyStore.values, retryKey),
  "queue item must remain when manifest publication fails",
);

console.log(
  `production snapshot handler bridge regression passed ` +
    `(source sha256=${productionGasSha256}, handlers=${handlerMappings.length}, ` +
    `mutation shapes=${mutationOrders.length}, notification transport calls=0)`,
);
