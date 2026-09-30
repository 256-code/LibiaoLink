// PoC-10 公共库：S3 预签名（与 server/src/storage/s3-object-storage.ts 同口径）+ JWT 构造/篡改
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

export const VIEW_PERMISSIONS = Object.freeze({
  edit: false, download: false, print: false, comment: false, chat: false, fillForms: false, protect: true,
});

export function b64url(input) {
  return Buffer.from(typeof input === "string" ? input : JSON.stringify(input)).toString("base64url");
}
export function signJwt(payload, secret) {
  const h = b64url({ alg: "HS256", typ: "JWT" });
  const p = b64url(payload);
  return h + "." + p + "." + createHmac("sha256", secret).update(h + "." + p).digest("base64url");
}
export function signJwtAlgNone(payload) {
  return b64url({ alg: "none", typ: "JWT" }) + "." + b64url(payload) + ".";
}
export function decodeJwtPayload(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}
export function tamperTokenPayload(token, mutate) {
  const parts = token.split(".");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  mutate(payload);
  return parts[0] + "." + b64url(payload) + "." + parts[2];
}

export function s3Client(endpoint) {
  return new S3Client({
    endpoint,
    region: process.env.S3_REGION,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
export async function putObject(objectKey, body, contentType) {
  await s3Client(process.env.S3_ENDPOINT).send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET, Key: objectKey, Body: body, ContentType: contentType,
  }));
}
export async function presignGet(objectKey, ttlSeconds, endpointOverride) {
  const client = s3Client(endpointOverride ?? process.env.S3_ENDPOINT);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey }), { expiresIn: ttlSeconds });
}

export function buildConfig({ key, url, fileType, docType, title }) {
  return {
    width: "100%",
    height: "100%",
    documentType: docType,
    document: { title, url, fileType, key },
    editorConfig: {
      mode: "view",
      lang: "zh-CN",
      user: { id: "poc10-probe", name: "PoC-10" },
      customization: { compactToolbar: true, hideRightMenu: true },
    },
    permissions: { ...VIEW_PERMISSIONS },
  };
}
