---
changelogVersion: 1
plugin: "voyage"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: "CHANGELOG.zh-CN.md"
---
# Changelog

## [1.0.0]

### Added

- Create text embeddings through `POST /voyage/v1/embeddings` with the Voyage 4 models (`voyage-4-large`, `voyage-4`, `voyage-4-lite`, `voyage-code-4`), the finance and law models, and the earlier Voyage 2 and 3 models. Requests and responses use Voyage's own format, including query and document input types, output dimensions, quantized data types, and base64 encoding.
- Rerank documents through `POST /voyage/v1/rerank` with `rerank-3`, `rerank-3-lite`, and the earlier rerank 1, 2, and 2.5 models.
- Embed text, images, and video through `POST /voyage/v1/multimodalembeddings` with `voyage-multimodal-3.5` and `voyage-multimodal-3`.
- Each call is billed for the usage Voyage reports: tokens for text embeddings and reranking, and text tokens plus image and video pixels for multimodal embeddings.
- A request whose response would exceed the gateway's 1 MiB limit for a single response is rejected before it reaches Voyage, so it is not charged. For large embedding batches, send fewer inputs per request, request base64 encoding, or choose a smaller output dimension or a quantized data type.
- Connect directly to Voyage AI or through another New API gateway with this plugin installed.

### Migration

- Configure each Voyage model with task usage expression billing. For text embedding and rerank models, the token price in the visual editor is per 1 million (1M) tokens. With USD selected, enter `0.12` for `voyage-4-large`, `0.06` for `voyage-4`, `0.02` for `voyage-4-lite`, or `0.05` for `rerank-3` to match Voyage's current published prices, or choose your own selling price. The equivalent expression for `voyage-4-large` is `tier("base", u("tokens") * 0.12 / 1000000)`.
- For the multimodal models, set both the text token price and the pixel price. Both are entered per 1 million units, so Voyage's published price of $0.60 per billion pixels is entered as `0.0006`. The expression that matches Voyage's current prices is `tier("base", u("text_tokens") * 0.12 / 1000000 + u("pixels") * 0.0006 / 1000000)`.
- Bind the plugin to a Task Plugin channel with your Voyage API key. The default upstream address is `https://api.voyageai.com`. In Voyage SDKs and HTTP clients, set the base URL to `https://<gateway>/voyage/v1` and use a gateway API token.
