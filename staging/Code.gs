// Sanheyuan admin snapshot staging backend.
// This project intentionally has no Google Sheets order write path.

var STAGING_SNAPSHOT_SCHEMA_VERSION_ = 1;
var STAGING_SNAPSHOT_BUCKET_COUNTS_ = [1, 2, 4];
var STAGING_SNAPSHOT_MAX_COMPRESSED_BYTES_PER_CHUNK_ = 500000;
var STAGING_SNAPSHOT_ORDER_COUNT_ = 376;
var STAGING_SNAPSHOT_ROOT_PATH_ = "adminOrderSnapshots/sanheyuan-staging";
var STAGING_SESSION_PREFIX_ = "STAGING_ADMIN_SESSION_";
var STAGING_AUTH_RESULT_PREFIX_ = "STAGING_ADMIN_AUTH_RESULT_";
var STAGING_SESSION_MAX_AGE_MS_ = 12 * 60 * 60 * 1000;
var STAGING_AUTH_RESULT_MAX_AGE_MS_ = 5 * 60 * 1000;

function stagingProperty_(name) {
  return String(
    PropertiesService.getScriptProperties().getProperty(name) || "",
  ).trim();
}

function requireStagingProperty_(name) {
  var value = stagingProperty_(name);
  if (!value) throw new Error("STAGING_CONFIG_MISSING:" + name);
  return value;
}

function assertStagingIdentity_() {
  var identity = {
    productId: requireStagingProperty_("PRODUCT_ID"),
    customerId: requireStagingProperty_("CUSTOMER_ID"),
    environment: requireStagingProperty_("ENVIRONMENT"),
    adminSiteUrl: requireStagingProperty_("ADMIN_SITE_URL"),
    firestoreProjectId: requireStagingProperty_("FIRESTORE_PROJECT_ID"),
  };
  if (
    identity.productId !== "farm-order-fulfillment" ||
    identity.customerId !== "sanheyuan" ||
    identity.environment !== "staging" ||
    identity.adminSiteUrl !==
      "https://zoesuau.github.io/milkpear-admin-staging/" ||
    identity.firestoreProjectId !== "sanheyuan-order-prod"
  ) {
    throw new Error("STAGING_IDENTITY_MISMATCH");
  }
  return identity;
}

function configureStagingNonSecretProperties() {
  var settings = {
    PRODUCT_ID: "farm-order-fulfillment",
    CUSTOMER_ID: "sanheyuan",
    ENVIRONMENT: "staging",
    ADMIN_SITE_URL: "https://zoesuau.github.io/milkpear-admin-staging/",
    LINE_LOGIN_CHANNEL_ID: "2010484376",
    FIRESTORE_PROJECT_ID: "sanheyuan-order-prod",
    FIRESTORE_DATABASE_ID: "(default)",
    STAGING_FORCE_FIRESTORE_FAILURE: "false",
  };
  var properties = PropertiesService.getScriptProperties();
  properties.setProperties(settings, false);
  Object.keys(settings).forEach(function (key) {
    if (String(properties.getProperty(key) || "") !== settings[key]) {
      throw new Error("STAGING_PROPERTY_VERIFY_FAILED:" + key);
    }
  });
  return inspectStagingEnvironment();
}

function inspectStagingEnvironment() {
  var properties = PropertiesService.getScriptProperties();
  var identity = assertStagingIdentity_();
  var allowed = stagingAllowedAdminIds_();
  return {
    ok: true,
    productId: identity.productId,
    customerId: identity.customerId,
    environment: identity.environment,
    adminSiteUrl: identity.adminSiteUrl,
    firestoreProjectId: identity.firestoreProjectId,
    firestoreDatabaseId: stagingProperty_("FIRESTORE_DATABASE_ID") ||
      "(default)",
    lineChannelId: stagingProperty_("LINE_LOGIN_CHANNEL_ID"),
    lineSecretConfigured:
      stagingProperty_("LINE_LOGIN_CHANNEL_SECRET").length >= 20,
    allowedAdminCount: allowed.length,
    driveFolderConfigured: !!stagingProperty_(
      "ADMIN_ORDER_SNAPSHOT_DRIVE_FOLDER_ID",
    ),
    driveFileConfigured: !!stagingProperty_(
      "ADMIN_ORDER_SNAPSHOT_DRIVE_FILE_ID",
    ),
    forcedFirestoreFailure:
      stagingProperty_("STAGING_FORCE_FIRESTORE_FAILURE") === "true",
    containsOrderData: false,
  };
}

function stagingJsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function doGet() {
  try {
    var inspection = inspectStagingEnvironment();
    return stagingJsonOutput_({
      ok: true,
      service: "sanheyuan-admin-snapshot-staging",
      environment: inspection.environment,
      lineSecretConfigured: inspection.lineSecretConfigured,
      allowedAdminCount: inspection.allowedAdminCount,
      driveFolderConfigured: inspection.driveFolderConfigured,
      driveFileConfigured: inspection.driveFileConfigured,
      containsOrderData: false,
    });
  } catch (error) {
    return stagingJsonOutput_({
      ok: false,
      service: "sanheyuan-admin-snapshot-staging",
      error: stagingSafeError_(error),
      containsOrderData: false,
    });
  }
}

function doPost(e) {
  var requestStartedAt = Date.now();
  var postData = {};
  try {
    postData = JSON.parse(
      e && e.postData && e.postData.contents ? e.postData.contents : "{}",
    );
    assertStagingIdentity_();
    if (postData.action === "adminAuth") {
      return stagingHandleAdminAuth_(postData);
    }
    if (postData.action === "adminValidateSession") {
      return stagingHandleValidateSession_(postData);
    }
    if (postData.action === "adminReadOrderSnapshot") {
      return stagingHandleReadSnapshot_(postData, requestStartedAt);
    }
    if (postData.action === "adminReadProductCatalog") {
      return stagingJsonOutput_({
        ok: true,
        action: "adminReadProductCatalog",
        products: [],
        catalogVersion: "staging-empty-v1",
      });
    }
    return stagingJsonOutput_({
      ok: false,
      error: "STAGING_ACTION_UNSUPPORTED",
    });
  } catch (error) {
    return stagingJsonOutput_({
      ok: false,
      action: String(postData.action || ""),
      error: stagingSafeError_(error),
      elapsedMs: Date.now() - requestStartedAt,
    });
  }
}

function stagingSafeError_(error) {
  var message = String(error && error.message ? error.message : error);
  var allowlist = [
    "ADMIN_SESSION_REQUIRED",
    "ADMIN_ORDER_SNAPSHOT_UNAVAILABLE",
    "LINE_AUTH_MISSING_FIELD",
    "LINE_AUTH_CONFIG_MISSING",
    "LINE_TOKEN_EXCHANGE_FAILED",
    "LINE_ID_TOKEN_VERIFY_FAILED",
    "LINE_NONCE_MISMATCH",
    "INVALID_REDIRECT_URI",
    "STAGING_IDENTITY_MISMATCH",
  ];
  if (allowlist.indexOf(message) !== -1) return message;
  if (message.indexOf("STAGING_CONFIG_MISSING:") === 0) return message;
  return "STAGING_TEMPORARILY_UNAVAILABLE";
}

function stagingAllowedAdminIds_() {
  return stagingProperty_("LINE_ADMIN_ALLOWED_USER_IDS")
    .split(",")
    .map(function (value) {
      return String(value || "").trim();
    })
    .filter(function (value) {
      return /^U[0-9a-f]{32}$/i.test(value);
    });
}

function stagingHash_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8,
  )
    .map(function (byte) {
      return (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, "0");
    })
    .join("");
}

function stagingRandomToken_() {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + ":" + Utilities.getUuid() + ":" + Date.now(),
      Utilities.Charset.UTF_8,
    ),
  ).replace(/=+$/g, "");
}

function stagingNormalizeDisplayName_(value) {
  return Array.from(
    String(value == null ? "" : value)
      .replace(/[\r\n]+/g, " ")
      .trim(),
  )
    .slice(0, 80)
    .join("");
}

function stagingCreateAdminSession_(lineUserId, displayName) {
  var token = stagingRandomToken_();
  var expiresAt = Date.now() + STAGING_SESSION_MAX_AGE_MS_;
  PropertiesService.getScriptProperties().setProperty(
    STAGING_SESSION_PREFIX_ + stagingHash_(token),
    JSON.stringify({
      lineUserId: lineUserId,
      displayName: stagingNormalizeDisplayName_(displayName),
      expiresAt: expiresAt,
    }),
  );
  return token;
}

function stagingGetValidAdminSession_(token) {
  var normalizedToken = String(token || "").trim();
  if (!normalizedToken) return null;
  var properties = PropertiesService.getScriptProperties();
  var key = STAGING_SESSION_PREFIX_ + stagingHash_(normalizedToken);
  var raw = properties.getProperty(key);
  if (!raw) return null;
  try {
    var session = JSON.parse(raw);
    if (
      Number(session.expiresAt) <= Date.now() ||
      stagingAllowedAdminIds_().indexOf(String(session.lineUserId || "")) === -1
    ) {
      properties.deleteProperty(key);
      return null;
    }
    return session;
  } catch (error) {
    properties.deleteProperty(key);
    return null;
  }
}

function stagingAuthResultKey_(nonce) {
  return STAGING_AUTH_RESULT_PREFIX_ + stagingHash_(nonce);
}

function stagingReadReusableAuthResult_(nonce) {
  var properties = PropertiesService.getScriptProperties();
  var key = stagingAuthResultKey_(nonce);
  var raw = properties.getProperty(key);
  if (!raw) return null;
  try {
    var result = JSON.parse(raw);
    if (Number(result.expiresAt) <= Date.now()) {
      properties.deleteProperty(key);
      return null;
    }
    if (!stagingGetValidAdminSession_(result.adminSessionToken)) return null;
    return result;
  } catch (error) {
    properties.deleteProperty(key);
    return null;
  }
}

function stagingStoreReusableAuthResult_(nonce, token, displayName) {
  PropertiesService.getScriptProperties().setProperty(
    stagingAuthResultKey_(nonce),
    JSON.stringify({
      adminSessionToken: token,
      adminDisplayName: stagingNormalizeDisplayName_(displayName),
      expiresAt: Date.now() + STAGING_AUTH_RESULT_MAX_AGE_MS_,
    }),
  );
}

function stagingHandleAdminAuth_(postData) {
  var code = String(postData.code || "").trim();
  var redirectUri = String(postData.redirectUri || "").trim();
  var codeVerifier = String(postData.codeVerifier || "").trim();
  var nonce = String(postData.nonce || "").trim();
  if (!code || !redirectUri || !codeVerifier || !nonce) {
    return stagingJsonOutput_({
      ok: false,
      action: "adminAuth",
      error: "LINE_AUTH_MISSING_FIELD",
    });
  }
  if (redirectUri !== requireStagingProperty_("ADMIN_SITE_URL")) {
    return stagingJsonOutput_({
      ok: false,
      action: "adminAuth",
      error: "INVALID_REDIRECT_URI",
    });
  }
  var reusable = stagingReadReusableAuthResult_(nonce);
  if (reusable) {
    return stagingJsonOutput_({
      ok: true,
      action: "adminAuth",
      allowed: true,
      adminSessionToken: reusable.adminSessionToken,
      adminDisplayName: reusable.adminDisplayName,
      reused: true,
    });
  }
  var tokenData = stagingExchangeLineCode_(
    code,
    redirectUri,
    codeVerifier,
    nonce,
  );
  var profile = stagingVerifyLineIdToken_(tokenData.id_token, nonce);
  var allowed = stagingAllowedAdminIds_().indexOf(profile.sub) !== -1;
  if (!allowed) {
    return stagingJsonOutput_({
      ok: true,
      action: "adminAuth",
      allowed: false,
    });
  }
  var sessionToken = stagingCreateAdminSession_(profile.sub, profile.name);
  var displayName = stagingNormalizeDisplayName_(profile.name) || "後台管理員";
  stagingStoreReusableAuthResult_(nonce, sessionToken, displayName);
  return stagingJsonOutput_({
    ok: true,
    action: "adminAuth",
    allowed: true,
    adminSessionToken: sessionToken,
    adminDisplayName: displayName,
  });
}

function stagingExchangeLineCode_(code, redirectUri, codeVerifier, nonce) {
  var channelId = requireStagingProperty_("LINE_LOGIN_CHANNEL_ID");
  var channelSecret = requireStagingProperty_("LINE_LOGIN_CHANNEL_SECRET");
  var response = UrlFetchApp.fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
      code_verifier: codeVerifier,
    },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error("LINE_TOKEN_EXCHANGE_FAILED");
  }
  var data = JSON.parse(response.getContentText() || "{}");
  if (!data.id_token) throw new Error("LINE_TOKEN_EXCHANGE_FAILED");
  return data;
}

function stagingVerifyLineIdToken_(idToken, nonce) {
  var response = UrlFetchApp.fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      id_token: String(idToken || ""),
      client_id: requireStagingProperty_("LINE_LOGIN_CHANNEL_ID"),
      nonce: nonce,
    },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error("LINE_ID_TOKEN_VERIFY_FAILED");
  }
  var profile = JSON.parse(response.getContentText() || "{}");
  if (!profile.sub) throw new Error("LINE_ID_TOKEN_VERIFY_FAILED");
  if (String(profile.nonce || "") !== nonce) {
    throw new Error("LINE_NONCE_MISMATCH");
  }
  return profile;
}

function stagingHandleValidateSession_(postData) {
  var session = stagingGetValidAdminSession_(postData.adminSessionToken);
  return stagingJsonOutput_({
    ok: !!session,
    action: "adminValidateSession",
    allowed: !!session,
    error: session ? undefined : "ADMIN_SESSION_REQUIRED",
  });
}

function stagingFirestoreBaseUrl_() {
  var projectId = requireStagingProperty_("FIRESTORE_PROJECT_ID");
  var databaseId = stagingProperty_("FIRESTORE_DATABASE_ID") || "(default)";
  return (
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId) +
    "/databases/" +
    (databaseId === "(default)" ? "(default)" : encodeURIComponent(databaseId)) +
    "/documents"
  );
}

function stagingFirestoreRequest_(method, path, fields) {
  var options = {
    method: String(method || "get").toLowerCase(),
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken(),
      "Content-Type": "application/json",
    },
    muteHttpExceptions: true,
  };
  if (fields !== undefined) {
    options.payload = JSON.stringify({ fields: fields });
  }
  var response = UrlFetchApp.fetch(
    stagingFirestoreBaseUrl_() + "/" + path,
    options,
  );
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("FIRESTORE_HTTP_" + code);
  }
  return response.getContentText()
    ? JSON.parse(response.getContentText())
    : {};
}

function stagingStringField_(value) {
  return { stringValue: String(value == null ? "" : value) };
}

function stagingIntegerField_(value) {
  return { integerValue: String(Math.max(0, Number(value) || 0)) };
}

function stagingTimestampField_(value) {
  return { timestampValue: new Date(value || Date.now()).toISOString() };
}

function stagingFieldValue_(document, fieldName) {
  var field = document && document.fields ? document.fields[fieldName] : null;
  if (!field) return "";
  if (field.stringValue !== undefined) return String(field.stringValue);
  if (field.integerValue !== undefined) return Number(field.integerValue) || 0;
  if (field.timestampValue !== undefined) return String(field.timestampValue);
  if (field.bytesValue !== undefined) return String(field.bytesValue);
  return "";
}

function stagingEncodePayload_(payload) {
  var json = JSON.stringify(payload);
  var blob = Utilities.gzip(
    Utilities.newBlob(json, "application/json", "staging-orders.json"),
  );
  var bytes = blob.getBytes();
  return {
    data: Utilities.base64Encode(bytes),
    bytes: bytes,
    compressedBytes: bytes.length,
  };
}

function stagingDecodePayload_(base64) {
  var bytes = Utilities.base64Decode(String(base64 || ""));
  return JSON.parse(
    Utilities.ungzip(
      Utilities.newBlob(bytes, "application/gzip"),
    ).getDataAsString("UTF-8"),
  );
}

function stagingChecksum_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (byte) {
      return (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, "0");
    })
    .join("");
}

function stagingStableHash_(value) {
  var text = String(value || "");
  var hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stagingPad_(value, width) {
  return String(value).padStart(width, "0");
}

function stagingSyntheticOrder_(index) {
  var sequence = index + 1;
  return {
    orderNo: "STAGING-" + stagingPad_(sequence, 4),
    createdAt:
      "2026/08/" + stagingPad_((index % 14) + 1, 2) + " 12:00:00",
    recipientName: "去識別化收件人" + sequence,
    recipientPhone: "0900" + stagingPad_(sequence, 6),
    recipientAddress: "測試縣測試路" + sequence + "號",
    buyerName: "去識別化訂購人" + sequence,
    buyerPhone: "0911" + stagingPad_(sequence, 6),
    itemsSummary: "測試商品 ×" + ((index % 4) + 1) + "盒",
    totalBoxes: (index % 4) + 1,
    shippingFee: 120,
    finalAmount: 1000 + (index % 9) * 100,
    paymentMethod: index % 2 ? "銀行轉帳" : "貨到付款",
    paymentStatus: index % 2 ? "已付款" : "未付款",
    paymentState: index % 2 ? "bank_paid" : "cod",
    expectedShippingDate:
      "2026/08/" + stagingPad_((index % 14) + 15, 2),
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

function stagingBuildSyntheticOrders_() {
  var orders = [];
  for (var i = 0; i < STAGING_SNAPSHOT_ORDER_COUNT_; i++) {
    orders.push(stagingSyntheticOrder_(i));
  }
  return orders;
}

function stagingBuildSnapshotPlan_(orders, version) {
  for (
    var candidateIndex = 0;
    candidateIndex < STAGING_SNAPSHOT_BUCKET_COUNTS_.length;
    candidateIndex++
  ) {
    var bucketCount = STAGING_SNAPSHOT_BUCKET_COUNTS_[candidateIndex];
    var buckets = [];
    for (var i = 0; i < bucketCount; i++) buckets.push([]);
    orders.forEach(function (order) {
      buckets[stagingStableHash_(order.orderNo) % bucketCount].push(order);
    });
    var encodedBuckets = buckets.map(function (bucket, bucketId) {
      return stagingEncodePayload_({
        schemaVersion: STAGING_SNAPSHOT_SCHEMA_VERSION_,
        version: version,
        bucketId: bucketId,
        orders: bucket,
      });
    });
    if (
      encodedBuckets.every(function (encoded) {
        return (
          encoded.compressedBytes <=
          STAGING_SNAPSHOT_MAX_COMPRESSED_BYTES_PER_CHUNK_
        );
      })
    ) {
      return {
        bucketCount: bucketCount,
        buckets: buckets,
        encodedBuckets: encodedBuckets,
      };
    }
  }
  throw new Error("STAGING_SNAPSHOT_EXCEEDS_FOUR_CHUNKS");
}

function stagingDriveFetch_(url, options) {
  var request = options || {};
  request.headers = request.headers || {};
  request.headers.Authorization = "Bearer " + ScriptApp.getOAuthToken();
  request.muteHttpExceptions = true;
  var response = UrlFetchApp.fetch(url, request);
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error("DRIVE_HTTP_" + response.getResponseCode());
  }
  return response;
}

function stagingEnsureDriveFolder_() {
  var properties = PropertiesService.getScriptProperties();
  var existingId = stagingProperty_("ADMIN_ORDER_SNAPSHOT_DRIVE_FOLDER_ID");
  if (existingId) return existingId;
  var query =
    "trashed=false and mimeType='application/vnd.google-apps.folder' and " +
    "appProperties has { key='stagingPurpose' and value='admin-order-snapshot' }";
  var listResponse = stagingDriveFetch_(
    "https://www.googleapis.com/drive/v3/files?q=" +
      encodeURIComponent(query) +
      "&fields=files(id,name)&spaces=drive",
    { method: "get" },
  );
  var files = JSON.parse(listResponse.getContentText() || "{}").files || [];
  if (files.length > 1) throw new Error("STAGING_DRIVE_FOLDER_DUPLICATED");
  var folderId = files.length ? files[0].id : "";
  if (!folderId) {
    var createResponse = stagingDriveFetch_(
      "https://www.googleapis.com/drive/v3/files?fields=id,name",
      {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({
          name: "三合院訂單快照備援 STAGING",
          mimeType: "application/vnd.google-apps.folder",
          appProperties: {
            stagingPurpose: "admin-order-snapshot",
            containsOrderData: "false",
          },
        }),
      },
    );
    folderId = JSON.parse(createResponse.getContentText() || "{}").id || "";
  }
  if (!folderId) throw new Error("STAGING_DRIVE_FOLDER_CREATE_FAILED");
  properties.setProperty("ADMIN_ORDER_SNAPSHOT_DRIVE_FOLDER_ID", folderId);
  return folderId;
}

function stagingWriteDriveFallback_(version, orders) {
  var folderId = stagingEnsureDriveFolder_();
  var encoded = stagingEncodePayload_({
    schemaVersion: STAGING_SNAPSHOT_SCHEMA_VERSION_,
    version: version,
    orderCount: orders.length,
    updatedAt: new Date().toISOString(),
    orders: orders,
  });
  var metadata = {
    name: "admin-orders-sanheyuan-staging-latest.json",
    parents: [folderId],
    mimeType: "application/json",
    appProperties: {
      stagingPurpose: "admin-order-snapshot-fallback",
      containsOrderData: "false",
    },
  };
  var body = JSON.stringify({
    version: version,
    encoding: "gzip-base64",
    data: encoded.data,
    compressedBytes: encoded.compressedBytes,
    containsOrderData: false,
  });
  var boundary = "staging_snapshot_" + Utilities.getUuid().replace(/-/g, "");
  var multipart =
    "--" + boundary + "\r\n" +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    body + "\r\n" +
    "--" + boundary + "--";
  var response = stagingDriveFetch_(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
    {
      method: "post",
      contentType: "multipart/related; boundary=" + boundary,
      payload: multipart,
    },
  );
  var fileId = JSON.parse(response.getContentText() || "{}").id || "";
  if (!fileId) throw new Error("STAGING_DRIVE_FILE_CREATE_FAILED");
  var properties = PropertiesService.getScriptProperties();
  var previousFileId = stagingProperty_("ADMIN_ORDER_SNAPSHOT_DRIVE_FILE_ID");
  properties.setProperty("ADMIN_ORDER_SNAPSHOT_DRIVE_FILE_ID", fileId);
  properties.setProperty("ADMIN_ORDER_SNAPSHOT_DRIVE_VERSION", version);
  if (previousFileId && previousFileId !== fileId) {
    try {
      stagingDriveFetch_(
        "https://www.googleapis.com/drive/v3/files/" +
          encodeURIComponent(previousFileId),
        { method: "delete" },
      );
    } catch (cleanupError) {
      console.log("STAGING_OLD_DRIVE_FILE_CLEANUP_FAILED");
    }
  }
  return {
    fileId: fileId,
    compressedBytes: encoded.compressedBytes,
    data: encoded.data,
  };
}

function stagingReadDriveFallback_() {
  var fileId = requireStagingProperty_("ADMIN_ORDER_SNAPSHOT_DRIVE_FILE_ID");
  var response = stagingDriveFetch_(
    "https://www.googleapis.com/drive/v3/files/" +
      encodeURIComponent(fileId) +
      "?alt=media",
    { method: "get" },
  );
  var payload = JSON.parse(response.getContentText() || "{}");
  if (payload.encoding !== "gzip-base64" || !payload.data) {
    throw new Error("STAGING_DRIVE_PAYLOAD_INVALID");
  }
  return payload;
}

function stagingWriteSyntheticSnapshot_(orders, versionLabel) {
  var version =
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMddHHmmssSSS") +
    "-staging-" +
    String(versionLabel || "seed").replace(/[^a-z0-9_-]/gi, "").slice(0, 32);
  var snapshotPlan = stagingBuildSnapshotPlan_(orders, version);
  var manifestEntries = [];
  var totalCompressedBytes = 0;
  snapshotPlan.buckets.forEach(function (bucket, bucketId) {
    var encoded = snapshotPlan.encodedBuckets[bucketId];
    var checksum = stagingChecksum_(encoded.bytes);
    var path =
      STAGING_SNAPSHOT_ROOT_PATH_ +
      "/chunks/b" +
      stagingPad_(bucketId, 3) +
      "-s0";
    stagingFirestoreRequest_("patch", path, {
      schemaVersion: stagingIntegerField_(STAGING_SNAPSHOT_SCHEMA_VERSION_),
      version: stagingStringField_(version),
      bucketId: stagingIntegerField_(bucketId),
      slot: stagingIntegerField_(0),
      checksum: stagingStringField_(checksum),
      orderCount: stagingIntegerField_(bucket.length),
      compressedBytes: stagingIntegerField_(encoded.compressedBytes),
      payload: { bytesValue: encoded.data },
      updatedAt: stagingTimestampField_(new Date()),
    });
    manifestEntries.push({
      bucketId: bucketId,
      slot: 0,
      path: path,
      checksum: checksum,
      orderCount: bucket.length,
      compressedBytes: encoded.compressedBytes,
    });
    totalCompressedBytes += encoded.compressedBytes;
  });
  var now = new Date();
  stagingFirestoreRequest_("patch", STAGING_SNAPSHOT_ROOT_PATH_, {
    schemaVersion: stagingIntegerField_(STAGING_SNAPSHOT_SCHEMA_VERSION_),
    currentVersion: stagingStringField_(version),
    orderCount: stagingIntegerField_(orders.length),
    bucketCount: stagingIntegerField_(snapshotPlan.bucketCount),
    compressedBytes: stagingIntegerField_(totalCompressedBytes),
    chunksJson: stagingStringField_(JSON.stringify(manifestEntries)),
    updatedAt: stagingTimestampField_(now),
    containsOrderData: { booleanValue: false },
  });
  var drive = stagingWriteDriveFallback_(version, orders);
  return {
    ok: true,
    environment: "staging",
    version: version,
    orderCount: orders.length,
    bucketCount: manifestEntries.length,
    firestoreCompressedBytes: totalCompressedBytes,
    driveCompressedBytes: drive.compressedBytes,
    driveFolderConfigured: true,
    driveFileConfigured: true,
    containsOrderData: false,
  };
}

function seedStagingSyntheticSnapshot() {
  assertStagingIdentity_();
  if (stagingAllowedAdminIds_().length !== 1) {
    throw new Error("STAGING_ADMIN_ALLOWLIST_INVALID");
  }
  if (stagingProperty_("LINE_LOGIN_CHANNEL_SECRET").length < 20) {
    throw new Error("STAGING_LINE_SECRET_INVALID");
  }
  return stagingWriteSyntheticSnapshot_(
    stagingBuildSyntheticOrders_(),
    "seed",
  );
}

function stagingReadManifest_() {
  var document = stagingFirestoreRequest_(
    "get",
    STAGING_SNAPSHOT_ROOT_PATH_,
  );
  var version = stagingFieldValue_(document, "currentVersion");
  var chunksJson = stagingFieldValue_(document, "chunksJson");
  if (!version || !chunksJson) throw new Error("STAGING_SNAPSHOT_EMPTY");
  return {
    schemaVersion: Number(stagingFieldValue_(document, "schemaVersion")),
    version: version,
    orderCount: Number(stagingFieldValue_(document, "orderCount")),
    bucketCount: Number(stagingFieldValue_(document, "bucketCount")),
    compressedBytes: Number(
      stagingFieldValue_(document, "compressedBytes"),
    ),
    updatedAt: stagingFieldValue_(document, "updatedAt"),
    chunks: JSON.parse(chunksJson),
  };
}

function stagingReadChunks_(entries) {
  var requestedEntries = entries || [];
  if (!requestedEntries.length) return [];
  var documentBaseUrl = stagingFirestoreBaseUrl_();
  var documentNamePrefix = documentBaseUrl.replace(
    "https://firestore.googleapis.com/v1/",
    "",
  );
  var documentNames = requestedEntries.map(function (entry) {
    return documentNamePrefix + "/" + entry.path;
  });
  var response = UrlFetchApp.fetch(
    documentBaseUrl.replace(/\/documents$/, "/documents:batchGet"),
    {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken(),
      },
      payload: JSON.stringify({ documents: documentNames }),
      muteHttpExceptions: true,
    },
  );
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("FIRESTORE_BATCH_GET_HTTP_" + code);
  }
  var batch = JSON.parse(response.getContentText() || "[]");
  if (!Array.isArray(batch)) batch = [batch];
  var documentsByName = {};
  batch.forEach(function (result) {
    if (result && result.found && result.found.name) {
      documentsByName[String(result.found.name)] = result.found;
    }
  });
  return requestedEntries.map(function (entry, index) {
    var document = documentsByName[documentNames[index]];
    if (!document) throw new Error("STAGING_SNAPSHOT_CHUNK_MISSING");
    var data = stagingFieldValue_(document, "payload");
    var checksum = stagingFieldValue_(document, "checksum");
    if (!data || checksum !== entry.checksum) {
      throw new Error("STAGING_SNAPSHOT_CHUNK_MISMATCH");
    }
    return {
      bucketId: Number(entry.bucketId),
      checksum: checksum,
      encoding: "gzip-base64",
      data: data,
      orderCount: Number(entry.orderCount) || 0,
      compressedBytes: Number(entry.compressedBytes) || 0,
    };
  });
}

function verifyStagingSyntheticSnapshot() {
  assertStagingIdentity_();
  var manifest = stagingReadManifest_();
  var firestoreOrders = [];
  stagingReadChunks_(manifest.chunks).forEach(function (chunk) {
    var decoded = stagingDecodePayload_(chunk.data);
    firestoreOrders = firestoreOrders.concat(decoded.orders || []);
  });
  var drive = stagingReadDriveFallback_();
  var driveOrders = stagingDecodePayload_(drive.data).orders || [];
  if (
    manifest.orderCount !== STAGING_SNAPSHOT_ORDER_COUNT_ ||
    firestoreOrders.length !== STAGING_SNAPSHOT_ORDER_COUNT_ ||
    driveOrders.length !== STAGING_SNAPSHOT_ORDER_COUNT_
  ) {
    throw new Error("STAGING_SNAPSHOT_VERIFY_FAILED");
  }
  return {
    ok: true,
    version: manifest.version,
    orderCount: manifest.orderCount,
    bucketCount: manifest.chunks.length,
    firestoreMatches: firestoreOrders.length === manifest.orderCount,
    driveMatches: driveOrders.length === manifest.orderCount,
    containsOrderData: false,
  };
}

function stagingCloneJson_(value) {
  return JSON.parse(JSON.stringify(value));
}

function stagingFindSyntheticOrderIndex_(orders, orderNo) {
  for (var i = 0; i < orders.length; i++) {
    if (String(orders[i].orderNo) === String(orderNo)) return i;
  }
  return -1;
}

function stagingApplySyntheticMutationScenario_(orders, scenario) {
  var nextOrders = stagingCloneJson_(orders || []);
  var targetIndex = 0;
  if (scenario === "add") {
    var added = stagingSyntheticOrder_(STAGING_SNAPSHOT_ORDER_COUNT_ + 1000);
    added.orderNo = "STAGING-MUTATION-NEW";
    added.orderStatus = "新訂單";
    added.orderSource = "管理員新增的訂單";
    if (stagingFindSyntheticOrderIndex_(nextOrders, added.orderNo) !== -1) {
      throw new Error("STAGING_MUTATION_ADD_DUPLICATE");
    }
    nextOrders.push(added);
    return nextOrders;
  }
  if (!nextOrders.length) throw new Error("STAGING_MUTATION_ORDER_MISSING");
  if (scenario === "cancel") targetIndex = 1;
  if (scenario === "shipped" || scenario === "notification") targetIndex = 2;
  if (!nextOrders[targetIndex]) {
    throw new Error("STAGING_MUTATION_TARGET_MISSING:" + scenario);
  }
  var order = nextOrders[targetIndex];
  if (scenario === "edit") {
    order.recipientName = "測試修改收件人";
    order.recipientAddress = "測試縣修改路88號";
    order.itemsSummary = "測試商品A ×2｜測試商品B ×1";
    order.finalAmount = 4321;
    order.adminNote = "隔離完整修改測試";
  } else if (scenario === "payment") {
    order.paymentMethod = "銀行轉帳";
    order.paymentState = "bank_paid";
    order.paymentStatus = "已付款";
  } else if (scenario === "schedule") {
    order.expectedShippingDate = "2026/08/29";
    order.orderStatus = "已安排出貨日期";
    order.requestedShippingBatchId = "STAGING-BATCH-0829";
    order.requestedShippingBatchLabel = "8/29 測試批次";
    order.shippingDateNoticeMode = "line";
  } else if (scenario === "cancel") {
    order.orderStatus = "已取消";
    order.lastUpdatedBy = "隔離測試管理員";
    order.lastUpdatedAt = "2026/08/14 14:30:00";
  } else if (scenario === "shipped") {
    order.orderStatus = "已寄出";
    order.actualShippingDate = "2026/08/30";
    order.trackingNo = "STAGING123456789";
  } else if (scenario === "notification") {
    order.orderStatus = "已寄出";
    order.actualShippingDate = "2026/08/30";
    order.trackingNo = "STAGING123456789";
    order.notificationStatus = "sent";
    order.lastNotificationType = "shipment_notice";
    order.lastNotificationMethod = "line_push";
    order.lastNotificationAt = "2026/08/30 16:00:00";
  } else {
    throw new Error("STAGING_MUTATION_SCENARIO_INVALID:" + scenario);
  }
  return nextOrders;
}

function stagingReadAllSyntheticSnapshotOrders_() {
  var manifest = stagingReadManifest_();
  var orders = [];
  stagingReadChunks_(manifest.chunks).forEach(function (chunk) {
    var decoded = stagingDecodePayload_(chunk.data);
    orders = orders.concat(decoded.orders || []);
  });
  return { manifest: manifest, orders: orders };
}

function stagingCanonicalOrdersJson_(orders) {
  return JSON.stringify(
    stagingCloneJson_(orders || []).sort(function (left, right) {
      return String(left.orderNo).localeCompare(String(right.orderNo));
    }),
  );
}

function testStagingSyntheticMutationConsistency() {
  assertStagingIdentity_();
  var baselineOrders = stagingBuildSyntheticOrders_();
  var authoritativeOrders = stagingCloneJson_(baselineOrders);
  var scenarioNames = [
    "add",
    "edit",
    "payment",
    "schedule",
    "cancel",
    "shipped",
    "notification",
  ];
  var scenarioResults = [];
  var testError = null;
  var restoreResult = null;
  try {
    scenarioNames.forEach(function (scenario) {
      authoritativeOrders = stagingApplySyntheticMutationScenario_(
        authoritativeOrders,
        scenario,
      );
      var writeResult = stagingWriteSyntheticSnapshot_(
        authoritativeOrders,
        "mutation-" + scenario,
      );
      var firestore = stagingReadAllSyntheticSnapshotOrders_();
      var drive = stagingReadDriveFallback_();
      var driveOrders = stagingDecodePayload_(drive.data).orders || [];
      var authoritativeJson = stagingCanonicalOrdersJson_(authoritativeOrders);
      var firestoreMatches =
        stagingCanonicalOrdersJson_(firestore.orders) === authoritativeJson;
      var driveMatches =
        stagingCanonicalOrdersJson_(driveOrders) === authoritativeJson;
      if (!firestoreMatches || !driveMatches) {
        throw new Error("STAGING_MUTATION_CONSISTENCY_FAILED:" + scenario);
      }
      scenarioResults.push({
        scenario: scenario,
        orderCount: authoritativeOrders.length,
        bucketCount: writeResult.bucketCount,
        firestoreMatches: firestoreMatches,
        driveMatches: driveMatches,
        browserMatchesAuthoritativeSnapshot: firestoreMatches,
      });
    });
  } catch (error) {
    testError = error;
  } finally {
    restoreResult = stagingWriteSyntheticSnapshot_(baselineOrders, "restored");
  }
  if (testError) throw testError;
  return {
    ok: true,
    environment: "staging",
    containsOrderData: false,
    scenarios: scenarioResults,
    finalTestOrderCount: authoritativeOrders.length,
    restored: restoreResult.orderCount === STAGING_SNAPSHOT_ORDER_COUNT_,
    restoredOrderCount: restoreResult.orderCount,
  };
}

function forceStagingFirestoreFailure() {
  assertStagingIdentity_();
  PropertiesService.getScriptProperties().setProperty(
    "STAGING_FORCE_FIRESTORE_FAILURE",
    "true",
  );
  return { ok: true, forcedFirestoreFailure: true };
}

function restoreStagingFirestorePrimary() {
  assertStagingIdentity_();
  PropertiesService.getScriptProperties().setProperty(
    "STAGING_FORCE_FIRESTORE_FAILURE",
    "false",
  );
  return { ok: true, forcedFirestoreFailure: false };
}

function stagingHandleReadSnapshot_(postData, requestStartedAt) {
  var sessionStartedAt = Date.now();
  var session = stagingGetValidAdminSession_(postData.adminSessionToken);
  var sessionMs = Date.now() - sessionStartedAt;
  if (!session) {
    return stagingJsonOutput_({
      ok: false,
      action: "adminReadOrderSnapshot",
      error: "ADMIN_SESSION_REQUIRED",
      requestId: String(postData.requestId || "").slice(0, 160),
      elapsedMs: Date.now() - requestStartedAt,
    });
  }
  var manifestMs = 0;
  var chunksMs = 0;
  var firestoreStartedAt = Date.now();
  try {
    if (stagingProperty_("STAGING_FORCE_FIRESTORE_FAILURE") === "true") {
      throw new Error("STAGING_FORCED_FIRESTORE_FAILURE");
    }
    var manifestStartedAt = Date.now();
    var manifest = stagingReadManifest_();
    manifestMs = Date.now() - manifestStartedAt;
    var knownVersion = String(postData.knownVersion || "").trim();
    if (knownVersion && knownVersion === manifest.version) {
      return stagingJsonOutput_({
        ok: true,
        action: "adminReadOrderSnapshot",
        source: "firestore",
        unchanged: true,
        version: manifest.version,
        orderCount: manifest.orderCount,
        updatedAt: manifest.updatedAt,
        admin: { displayName: session.displayName || "後台管理員" },
        requestId: String(postData.requestId || "").slice(0, 160),
        timing: {
          sessionMs: sessionMs,
          manifestMs: manifestMs,
          chunksMs: 0,
          firestoreMs: Date.now() - firestoreStartedAt,
          driveMs: 0,
        },
        elapsedMs: Date.now() - requestStartedAt,
      });
    }
    var known = {};
    (Array.isArray(postData.knownChunks) ? postData.knownChunks : [])
      .slice(0, 128)
      .forEach(function (entry) {
        if (entry && entry.checksum) {
          known[Number(entry.bucketId)] = String(entry.checksum);
        }
      });
    var changedEntries = manifest.chunks.filter(function (entry) {
      return known[Number(entry.bucketId)] !== entry.checksum;
    });
    var chunksStartedAt = Date.now();
    var chunks = stagingReadChunks_(changedEntries);
    chunksMs = Date.now() - chunksStartedAt;
    return stagingJsonOutput_({
      ok: true,
      action: "adminReadOrderSnapshot",
      source: "firestore",
      unchanged: false,
      version: manifest.version,
      schemaVersion: manifest.schemaVersion,
      orderCount: manifest.orderCount,
      bucketCount: manifest.bucketCount,
      compressedBytes: manifest.compressedBytes,
      updatedAt: manifest.updatedAt,
      chunks: chunks,
      manifest: manifest.chunks.map(function (entry) {
        return {
          bucketId: entry.bucketId,
          checksum: entry.checksum,
          orderCount: entry.orderCount,
          compressedBytes: entry.compressedBytes,
        };
      }),
      admin: { displayName: session.displayName || "後台管理員" },
      requestId: String(postData.requestId || "").slice(0, 160),
      timing: {
        sessionMs: sessionMs,
        manifestMs: manifestMs,
        chunksMs: chunksMs,
        firestoreMs: Date.now() - firestoreStartedAt,
        driveMs: 0,
      },
      elapsedMs: Date.now() - requestStartedAt,
    });
  } catch (firestoreError) {
    var firestoreMs = Date.now() - firestoreStartedAt;
    var driveStartedAt = Date.now();
    try {
      var drive = stagingReadDriveFallback_();
      return stagingJsonOutput_({
        ok: true,
        action: "adminReadOrderSnapshot",
        source: "drive",
        stale: true,
        unchanged: false,
        version: drive.version,
        encoding: drive.encoding,
        data: drive.data,
        compressedBytes: drive.compressedBytes,
        admin: { displayName: session.displayName || "後台管理員" },
        requestId: String(postData.requestId || "").slice(0, 160),
        timing: {
          sessionMs: sessionMs,
          manifestMs: manifestMs,
          chunksMs: chunksMs,
          firestoreMs: firestoreMs,
          driveMs: Date.now() - driveStartedAt,
        },
        elapsedMs: Date.now() - requestStartedAt,
      });
    } catch (driveError) {
      return stagingJsonOutput_({
        ok: false,
        action: "adminReadOrderSnapshot",
        error: "ADMIN_ORDER_SNAPSHOT_UNAVAILABLE",
        requestId: String(postData.requestId || "").slice(0, 160),
        timing: {
          sessionMs: sessionMs,
          manifestMs: manifestMs,
          chunksMs: chunksMs,
          firestoreMs: firestoreMs,
          driveMs: Date.now() - driveStartedAt,
        },
        elapsedMs: Date.now() - requestStartedAt,
      });
    }
  }
}
