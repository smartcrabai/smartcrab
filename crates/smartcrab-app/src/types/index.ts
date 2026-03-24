export * from './pipeline';
export * from './execution';
export * from './adapters';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  yamlContent?: string;
  timestamp: string;
}
