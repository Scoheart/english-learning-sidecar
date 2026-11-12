export interface PlaybackTicket { signal: AbortSignal; current(): boolean }
export interface PlaybackSession {
  readonly text: string | null;
  stop(): void;
  begin(text: string): PlaybackTicket;
  attach(ticket: PlaybackTicket, audio: HTMLAudioElement, url: string, revokeUrl: (url: string) => void): boolean;
}
export function createPlaybackSession(options: { cancelSpeech(): void; onStop(): void }): PlaybackSession;
export type ModelAuthMode = 'bearer' | 'none';
export interface TextModelPreset { id: string; name: string; baseUrl: string; authMode: ModelAuthMode }
export interface ModelFormData { id?: string; name: string; kind: 'text' | 'speech'; baseUrl: string; model: string; apiKey?: string; clearApiKey?: boolean; voice?: string; temperature?: string; authMode?: ModelAuthMode }
export function modelPayload(form: ModelFormData, original?: { baseUrl: string }): Record<string, unknown>;
export function modelTestPayload(draft: SettingsModelDraft, form: ModelFormData): Record<string, unknown>;
export function selectMatchingEvent<T extends { id: string }>(events: T[], selectedId: string | null): T | null;
export function requireOk(response: Response): Promise<Response>;
export interface SettingsModel { id: string; name: string; kind: 'text' | 'speech'; baseUrl: string; model: string; apiKey?: string; authMode?: ModelAuthMode; apiKeySet: boolean; apiKeyMasked: string; voice?: string; temperature?: number | null }
export interface SettingsModelDraft { models: SettingsModel[]; activeTextId: string | null; activeSpeechId: string | null }
export function stageSettingsModel(draft: SettingsModelDraft, form: Parameters<typeof modelPayload>[0], makeId?: () => string): SettingsModelDraft;
export function removeSettingsModel(draft: SettingsModelDraft, id: string): SettingsModelDraft;
