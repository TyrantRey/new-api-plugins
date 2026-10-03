// Voyage AI API: https://docs.voyageai.com/reference/embeddings-api
// Voyage does not publish its tokenizers. Reserve about one token per
// character plus an allowance per text for special tokens and the retrieval
// prompt; completion replaces this estimate with upstream usage.
const TEXT_OVERHEAD_TOKENS = 16;
const MAX_INPUTS = 1000;
// Largest totals one request can bill under the documented request limits: 1M
// tokens for the lite embedding models, 600K for rerankers, and 320K per
// multimodal request at 560 image pixels or 1,120 video pixels per token.
const MAX_EMBEDDING_TOKENS = 1000000;
const MAX_RERANK_TOKENS = 600000;
const MAX_MULTIMODAL_TOKENS = 320000;
const MAX_MULTIMODAL_PIXELS = MAX_MULTIMODAL_TOKENS * 1120;
// An image is billed as at most 2M pixels; a video fills at most one
// 32K-token input.
const MAX_IMAGE_PIXELS = 2000000;
const MAX_VIDEO_PIXELS = 32000 * 1120;
// The host reads at most 1 MiB of a submit response and fails a larger one
// after Voyage has already billed the call, so requests whose result cannot
// fit are rejected before submission.
const MAX_RESPONSE_BYTES = 1048576;
const RESPONSE_ENVELOPE_BYTES = 128;
const RESULT_ENVELOPE_BYTES = 64;

// Default output dimension of each text embedding model, used to size responses.
const EMBEDDING_MODELS = {
  "voyage-4-large": 1024,
  "voyage-4": 1024,
  "voyage-4-lite": 1024,
  "voyage-code-4": 1024,
  "voyage-finance-2": 1024,
  "voyage-law-2": 1024,
  "voyage-3-large": 1024,
  "voyage-3.5": 1024,
  "voyage-3.5-lite": 1024,
  "voyage-code-3": 1024,
  "voyage-3": 1024,
  "voyage-3-lite": 512,
  "voyage-multilingual-2": 1024,
  "voyage-large-2-instruct": 1024,
  "voyage-large-2": 1536,
  "voyage-code-2": 1536,
  "voyage-2": 1024,
};
const MULTIMODAL_MODELS = ["voyage-multimodal-3.5", "voyage-multimodal-3"];
const MULTIMODAL_DIMENSION = 1024;
const RERANK_MODELS = ["rerank-3", "rerank-3-lite", "rerank-2.5", "rerank-2.5-lite", "rerank-2", "rerank-2-lite", "rerank-1", "rerank-lite-1"];

const INPUT_TYPES = ["query", "document"];
const OUTPUT_TYPES = ["float", "int8", "uint8", "binary", "ubinary"];
const CONTENT_TYPES = ["text", "image_url", "image_base64", "video_url", "video_base64"];

const TOKEN_USAGE_SCHEMA = {
  tokens: {
    type: "number",
    unit: "token",
    description: { en: "Token unit price", zh: "Token 单价" },
  },
};

const MULTIMODAL_USAGE_SCHEMA = {
  text_tokens: {
    type: "number",
    unit: "token",
    description: { en: "Text token unit price", zh: "文本 token 单价" },
  },
  // Pixels use the token unit for its per-million price scale and value range:
  // count facts are capped at 128, far below the pixels of a single image.
  pixels: {
    type: "number",
    unit: "token",
    description: { en: "Image and video pixel unit price", zh: "图片与视频像素单价" },
  },
};

export const meta = {
  apiVersion: 1,
  key: "voyage",
  name: "Voyage AI",
  version: "1.0.0",
  icon: "Voyage.Color",
  author: { name: "TyrantRey", url: "https://github.com/TyrantRey" },
  website: "https://www.voyageai.com",
  description: {
    en: "Voyage AI text embeddings, multimodal embeddings, and rerankers through Voyage's native API",
    zh: "通过 Voyage 原生接口调用 Voyage AI 文本向量、多模态向量与重排序模型",
  },
  baseUrl: "https://api.voyageai.com",
  auth: "api_key",
  models: Object.keys(EMBEDDING_MODELS).concat(MULTIMODAL_MODELS, RERANK_MODELS),
  upstreams: ["vendor", "new_api"],
  fetchMode: "per_task",
  // Every Voyage endpoint answers synchronously and has no task to re-query;
  // the complete response is delivered once and never persisted.
  routes: [
    {
      method: "POST",
      path: "/voyage/v1/embeddings",
      type: "submit",
      decode: "decodeEmbeddings",
      render: "renderResult",
      models: Object.keys(EMBEDDING_MODELS),
      retainResult: false,
    },
    {
      method: "POST",
      path: "/voyage/v1/multimodalembeddings",
      type: "submit",
      decode: "decodeMultimodalEmbeddings",
      render: "renderResult",
      models: MULTIMODAL_MODELS,
      retainResult: false,
    },
    {
      method: "POST",
      path: "/voyage/v1/rerank",
      type: "submit",
      decode: "decodeRerank",
      render: "renderResult",
      models: RERANK_MODELS,
      retainResult: false,
    },
  ],
  usageSchema: TOKEN_USAGE_SCHEMA,
  usageExamples: [{ label: "Embed · 100 texts × 500 tokens", facts: { tokens: 50000 } }],
  usageProfiles: [
    {
      models: RERANK_MODELS,
      schema: TOKEN_USAGE_SCHEMA,
      examples: [{ label: "Rerank · 20-token query · 50 × 500-token docs", facts: { tokens: 26000 } }],
    },
    {
      models: MULTIMODAL_MODELS,
      schema: MULTIMODAL_USAGE_SCHEMA,
      examples: [
        { label: "1 image (1000 × 1000) · 100 text tokens", facts: { text_tokens: 100, pixels: 1000000 } },
        { label: "100 images · 2M pixels each", facts: { text_tokens: 0, pixels: 200000000 } },
      ],
    },
  ],
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoolean(value) {
  return typeof value === "boolean";
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isTextList(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_INPUTS &&
    value.every(function (text) {
      return typeof text === "string";
    })
  );
}

function oneOf(options) {
  return function (value) {
    return options.includes(value);
  };
}

// Copies a validated optional parameter. The official SDKs send unset
// parameters as null, which Voyage treats the same as an omitted one.
function setOptional(request, body, name, valid, expected) {
  const value = body[name];
  if (value === undefined || value === null) return;
  if (!valid(value)) throw new Error(name + " must be " + expected);
  request[name] = value;
}

function modelKind(model) {
  if (Object.prototype.hasOwnProperty.call(EMBEDDING_MODELS, model)) return "embeddings";
  if (MULTIMODAL_MODELS.includes(model)) return "multimodalembeddings";
  if (RERANK_MODELS.includes(model)) return "rerank";
  throw new Error("Unsupported Voyage model; use a declared model or map an alias to it");
}

// Encoded size of one embedding. Voyage's documented responses print float
// values with nine decimal places ("-0.016709786,"); quantized values take at
// most five bytes ("-128,"), and binary types pack eight dimensions into each
// value.
function embeddingBytes(dimension, outputType, base64) {
  const values = outputType === "binary" || outputType === "ubinary" ? Math.ceil(dimension / 8) : dimension;
  if (base64) return Math.ceil((values * (outputType === "float" ? 4 : 1)) / 3) * 4 + 2;
  return values * (outputType === "float" ? 13 : 5);
}

// Upper bound of a JSON-encoded string, allowing for escaped non-ASCII text.
function jsonTextBytes(text) {
  let bytes = 2;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    bytes += code >= 0x20 && code < 0x80 && code !== 0x22 && code !== 0x5c ? 1 : 6;
  }
  return bytes;
}

function requireResponseFits(bytes, advice) {
  if (RESPONSE_ENVELOPE_BYTES + bytes > MAX_RESPONSE_BYTES) throw new Error("The response would exceed the 1 MiB gateway limit; " + advice);
}

function requireEmbeddingsFit(count, dimension, outputType, base64) {
  requireResponseFits(
    count * (RESULT_ENVELOPE_BYTES + embeddingBytes(dimension, outputType, base64)),
    "send fewer inputs per request, or request base64 encoding, a smaller output dimension, or a compact output data type"
  );
}

function embeddingsRequest(body, model) {
  const texts = typeof body.input === "string" ? [body.input] : body.input;
  if (!isTextList(texts)) throw new Error("input must be text or a list of 1 to 1,000 texts");
  const request = { input: body.input, model: model };
  setOptional(request, body, "input_type", oneOf(INPUT_TYPES), "query or document");
  setOptional(request, body, "truncation", isBoolean, "a boolean");
  setOptional(request, body, "output_dimension", isPositiveInteger, "a positive integer");
  setOptional(request, body, "output_dtype", oneOf(OUTPUT_TYPES), "float, int8, uint8, binary, or ubinary");
  setOptional(request, body, "encoding_format", oneOf(["base64"]), "base64");
  requireEmbeddingsFit(texts.length, request.output_dimension || EMBEDDING_MODELS[model], request.output_dtype || "float", request.encoding_format === "base64");

  let tokens = 0;
  for (const text of texts) tokens += text.length + TEXT_OVERHEAD_TOKENS;
  return { body: request, facts: { tokens: Math.min(tokens, MAX_EMBEDDING_TOKENS) } };
}

function multimodalRequest(body, model) {
  const inputs = body.inputs;
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_INPUTS) throw new Error("inputs must be a list of 1 to 1,000 inputs");
  let tokens = 0;
  let pixels = 0;
  for (const input of inputs) {
    if (!isObject(input) || !Array.isArray(input.content) || input.content.length === 0) throw new Error("Each input must have a nonempty content list");
    tokens += TEXT_OVERHEAD_TOKENS;
    for (const item of input.content) {
      if (!isObject(item) || !CONTENT_TYPES.includes(item.type) || typeof item[item.type] !== "string")
        throw new Error("Each content item must have type text, image_url, image_base64, video_url, or video_base64 and a text value under the same name");
      // Image and video sizes are unknown until Voyage decodes them, so each
      // one reserves the most it can be billed.
      if (item.type === "text") tokens += item.text.length;
      else pixels += item.type.startsWith("image") ? MAX_IMAGE_PIXELS : MAX_VIDEO_PIXELS;
    }
  }
  const request = { inputs: inputs, model: model };
  setOptional(request, body, "input_type", oneOf(INPUT_TYPES), "query or document");
  setOptional(request, body, "truncation", isBoolean, "a boolean");
  setOptional(request, body, "output_dimension", isPositiveInteger, "a positive integer");
  setOptional(request, body, "output_encoding", oneOf(["base64"]), "base64");
  requireEmbeddingsFit(inputs.length, request.output_dimension || MULTIMODAL_DIMENSION, "float", request.output_encoding === "base64");
  return { body: request, facts: { text_tokens: Math.min(tokens, MAX_MULTIMODAL_TOKENS), pixels: Math.min(pixels, MAX_MULTIMODAL_PIXELS) } };
}

function rerankRequest(body, model) {
  if (typeof body.query !== "string" || !body.query) throw new Error("query must be nonempty text");
  const documents = body.documents;
  if (!isTextList(documents)) throw new Error("documents must be a list of 1 to 1,000 texts");
  const request = { query: body.query, documents: documents, model: model };
  setOptional(request, body, "top_k", isPositiveInteger, "a positive integer");
  setOptional(request, body, "return_documents", isBoolean, "a boolean");
  setOptional(request, body, "truncation", isBoolean, "a boolean");

  const returned = Math.min(request.top_k || documents.length, documents.length);
  let bytes = returned * RESULT_ENVELOPE_BYTES;
  if (request.return_documents) {
    // Which documents rank highest is unknown, so assume the longest ones.
    const sizes = documents.map(jsonTextBytes).sort(function (left, right) {
      return right - left;
    });
    for (let index = 0; index < returned; index++) bytes += sizes[index];
  }
  requireResponseFits(bytes, "send fewer documents, lower top_k, or turn off return_documents");

  // Voyage bills the query once per document plus every document.
  let tokens = documents.length * (body.query.length + TEXT_OVERHEAD_TOKENS);
  for (const document of documents) tokens += document.length;
  return { body: request, facts: { tokens: Math.min(tokens, MAX_RERANK_TOKENS) } };
}

const REQUESTS = {
  embeddings: embeddingsRequest,
  multimodalembeddings: multimodalRequest,
  rerank: rerankRequest,
};

function voyageRequest(ctx) {
  if (!isObject(ctx.requestBody)) throw new Error("Request body must be a JSON object");
  const model = ctx.upstreamModel || ctx.model;
  const kind = modelKind(model);
  const converted = REQUESTS[kind](ctx.requestBody, model);
  return { path: kind, body: converted.body, facts: converted.facts };
}

export function buildSubmitRequest(ctx) {
  const request = voyageRequest(ctx);
  let baseUrl = ctx.baseUrl.replace(/\/+$/, "");
  // Accept channel base URLs with an optional /v1 suffix.
  if (baseUrl.endsWith("/v1")) baseUrl = baseUrl.slice(0, -3);
  const prefix = ctx.upstream && ctx.upstream.kind === "new_api" ? "/voyage" : "";
  return {
    url: baseUrl + prefix + "/v1/" + request.path,
    method: "POST",
    headers: {
      Authorization: "Bearer " + ctx.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: request.body,
  };
}

export function parseSubmitResponse(ctx, response) {
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error("Voyage returned HTTP " + response.statusCode);
  const body = response.body;
  if (!isObject(body) || !Array.isArray(body.data) || !isObject(body.usage)) throw new Error("Voyage response is missing data or usage");
  if (!ctx.publicTaskId) throw new Error("Missing gateway request ID");
  return {
    taskId: ctx.publicTaskId,
    taskData: body,
    immediate: { status: "SUCCESS", progress: "100%" },
  };
}

export function extractUsage(ctx) {
  const request = voyageRequest(ctx);
  if (ctx.usagePurpose === "billing_ratios") return null;
  return request.facts;
}

// Throwing preserves the reservation and makes the host log invalid usage.
// Never coerce a missing or implausible value to zero.
function reportedUsage(value, max, name) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error("Voyage " + name + " usage is missing or outside the request limits");
  return value;
}

export function extractUsageOnComplete(ctx, result, body) {
  const usage = (body && body.usage) || {};
  const kind = modelKind(ctx.upstreamModel || ctx.model);
  if (kind === "embeddings") return { tokens: reportedUsage(usage.total_tokens, MAX_EMBEDDING_TOKENS, "token") };
  if (kind === "rerank") return { tokens: reportedUsage(usage.total_tokens, MAX_RERANK_TOKENS, "token") };
  // Voyage omits the pixel counts of media a request or model does not use.
  const imagePixels = usage.image_pixels == null ? 0 : usage.image_pixels;
  const videoPixels = usage.video_pixels == null ? 0 : usage.video_pixels;
  return {
    text_tokens: reportedUsage(usage.text_tokens, MAX_MULTIMODAL_TOKENS, "text token"),
    pixels: reportedUsage(imagePixels + videoPixels, MAX_MULTIMODAL_PIXELS, "pixel"),
  };
}

// API v1 requires polling hooks, but Voyage always completes synchronously.
export function buildQueryRequest() {
  throw new Error("Voyage has no task retrieval endpoint");
}

export function parseTaskResult() {
  return { status: "UNKNOWN", reason: "Voyage has no asynchronous tasks" };
}

function decode(ctx, kind) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  const body = ctx.body.value;
  if (!isObject(body)) throw new Error("Request body must be a JSON object");
  if (typeof body.model !== "string" || !body.model.trim()) throw new Error("model is required");
  if (modelKind(body.model) !== kind) throw new Error("This model is served by a different Voyage endpoint");
  return { kind: "submit", model: body.model, action: kind, requestBody: REQUESTS[kind](body, body.model).body };
}

export const native = {
  decodeEmbeddings: function (ctx) {
    return decode(ctx, "embeddings");
  },
  decodeMultimodalEmbeddings: function (ctx) {
    return decode(ctx, "multimodalembeddings");
  },
  decodeRerank: function (ctx) {
    return decode(ctx, "rerank");
  },
  renderResult: function (ctx, task) {
    return task.data;
  },
  error: function (ctx, error) {
    return { detail: error.message };
  },
};
