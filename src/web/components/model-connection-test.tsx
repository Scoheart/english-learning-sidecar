import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { modelTestPayload, requireOk, type ModelFormData, type SettingsModelDraft } from '@/lib/reliability.js';

type Feedback = {
  form: ModelFormData;
  draft: SettingsModelDraft;
  status: 'testing' | 'success' | 'error';
  text?: string;
};

export function ModelConnectionTest({ form, draft, disabled }: {
  form: ModelFormData;
  draft: SettingsModelDraft;
  disabled: boolean;
}) {
  const active = useRef<AbortController | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const current = feedback?.form === form && feedback.draft === draft ? feedback : null;

  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
  }, [form, draft]);

  async function runTest() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setFeedback({ form, draft, status: 'testing' });
    try {
      const response = await requireOk(await fetch('/api/models/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(modelTestPayload(draft, form)),
        signal: controller.signal,
      }));
      const result = await response.json();
      if (!controller.signal.aborted) setFeedback({ form, draft, status: 'success', text: result.translation });
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ form, draft, status: 'error', text: error instanceof Error ? error.message : '模型测试失败。' });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled || current?.status === 'testing'} onClick={runTest}>
          {current?.status === 'testing' ? '测试中…' : '测试模型'}
        </Button>
        <span className="text-muted-foreground">发送一句固定样例，生成学习卡，不保存测试记录。</span>
      </div>
      {current?.status === 'error' && <p role="alert" className="text-destructive">{current.text}</p>}
      {current?.status === 'success' && <p role="status" className="break-words">样例翻译 · {current.text}</p>}
    </div>
  );
}
