---
changelogVersion: 1
plugin: "voyage"
version: "1.0.0"
locale: "zh-CN"
---
# Changelog

## [1.0.0]

### Added

- 通过 `POST /voyage/v1/embeddings` 生成文本向量，支持 Voyage 4 系列（`voyage-4-large`、`voyage-4`、`voyage-4-lite`、`voyage-code-4`）、金融与法律模型，以及更早的 Voyage 2、3 系列模型。请求和响应沿用 Voyage 原生格式，可指定查询或文档输入类型、输出维度、量化数据类型和 base64 编码。
- 通过 `POST /voyage/v1/rerank` 对文档重排序，支持 `rerank-3`、`rerank-3-lite`，以及更早的 rerank 1、2、2.5 系列模型。
- 通过 `POST /voyage/v1/multimodalembeddings` 为文本、图片和视频生成向量，支持 `voyage-multimodal-3.5` 和 `voyage-multimodal-3`。
- 每次调用按 Voyage 返回的实际用量结算：文本向量和重排序按 token 计费，多模态向量按文本 token 加图片与视频像素计费。
- 网关单次响应上限为 1 MiB。响应会超出上限的请求在发往 Voyage 之前就会被拒绝，不产生费用。批量生成向量时，可减少单次请求的输入数量、改用 base64 编码，或选择更小的输出维度或量化数据类型。
- 支持直连 Voyage AI，也可通过已安装此插件的另一台 New API 网关调用。

### Migration

- 为每个 Voyage 模型启用任务用量表达式计费。文本向量和重排序模型在可视化编辑器中的 token 单价以每 100 万（1M）token 为单位；选择美元时，`voyage-4-large` 填写 `0.12`、`voyage-4` 填写 `0.06`、`voyage-4-lite` 填写 `0.02`、`rerank-3` 填写 `0.05`，即对应 Voyage 当前公布的价格，也可设置自己的销售价格。`voyage-4-large` 对应的表达式为 `tier("base", u("tokens") * 0.12 / 1000000)`。
- 多模态模型需要同时设置文本 token 单价和像素单价。两者都以每 100 万单位填写，因此 Voyage 公布的每 10 亿像素 0.60 美元应填写为 `0.0006`。与 Voyage 当前价格一致的表达式为 `tier("base", u("text_tokens") * 0.12 / 1000000 + u("pixels") * 0.0006 / 1000000)`。
- 新建任务插件渠道并绑定此插件，填入 Voyage API Key，默认上游地址为 `https://api.voyageai.com`。在 Voyage SDK 或 HTTP 客户端中，将 Base URL 设置为 `https://<gateway>/voyage/v1`，并使用网关令牌。
