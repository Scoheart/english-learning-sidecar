// Presets seed editable fields. Model IDs come from the selected provider or local runtime.
export const TEXT_MODEL_PRESETS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', authMode: 'bearer' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', authMode: 'bearer' },
  { id: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', authMode: 'bearer' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', authMode: 'bearer' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', authMode: 'none' },
  { id: 'lm-studio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', authMode: 'none' },
  { id: 'litellm', name: 'LiteLLM Proxy', baseUrl: 'http://127.0.0.1:4000/v1', authMode: 'bearer' },
];
