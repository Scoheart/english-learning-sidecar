# Sidecar 多模型接入方案

目标是在 Web 和 macOS 上从同一组服务商预设建立配置，在保存前用固定样例验证学习卡，且本机 Ollama 可以无密钥运行。

## 调研和选择

- OpenRouter 与 Gemini 官方提供 OpenAI Chat Completions 兼容接口。Ollama、LM Studio 在本机提供同一协议。LiteLLM Proxy 可在用户自己的服务里将 Anthropic 等 API 转成这一协议。
- AI SDK 能调用原生厂商 API，但会增加桌面内置引擎的运行时依赖和打包工作。现有学习卡只需要一次非流式生成，不需要对话状态或工具调用。本次用统一协议并复用网关，不把网关设为必需服务。
- 模型目录只能辅助输入，不能证明账户有访问权限，也不能验证返回的学习卡。使用目标端点和当前表单的配置发出一次真实请求，走日常分析器和结果校验。
- 文本和语音是不同协议。本次面向文本学习模型。保留现有 TTS 接入。
- 预设只提供地址和认证默认值。允许手填模型 ID 和端点。云端仍要求 Key，本机免密需要显式选择，只允许回环地址。
- 测试只发送固定样例，不入队、不写学习记录、不保存配置。回环端点允许 180 秒生成时间以适应本机推理，云端仍为 90 秒。已有模型测试沿用和保存一致的凭据规则，换地址不得复用旧 Key。

参考：[OpenRouter](https://openrouter.ai/developers)、[Gemini](https://aistudio.google.com/docs/openai)、[Ollama](https://docs.ollama.com/api/openai-compatibility)、[LM Studio](https://lmstudio.ai/docs/developer/openai-compat)、[LiteLLM](https://docs.litellm.ai/docs/proxy/quick_start)、[AI SDK](https://ai-sdk.dev/docs/foundations/providers-and-models)。

## 实施与验收

1. 用 API 测试固定测试文本、草稿凭据隔离、无保存副作用和无密钥回环请求。新增共享预设与测试接口。保留旧配置和远程 HTTPS 规则。
2. Web 设置与 macOS 模型编辑器读取共享预设，并测试当前表单。展示成功翻译或可操作错误。测试期间保护表单状态，关闭时取消或忽略旧响应。运行中的 Web 队列定期同步状态，以恢复遗漏的实时通知。
3. 内置引擎复用同一服务创建逻辑。修复原生 Status 解码和首次配模型的生效。更新 macOS CI 的依赖安装和打包后冒烟验证。
4. 运行 Node 测试、类型检查、Web 构建、Swift 测试和自包含应用打包。用真实本机 Ollama 验证一次免密测试及日常队列分析。云端协议和凭据隔离通过模拟上游验证。
