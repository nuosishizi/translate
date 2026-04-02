export interface MessagePart {
  text: string;
}

export interface Message {
  role: 'user' | 'model';
  parts: MessagePart[];
}

export interface Session {
  id: string;
  name: string;
  messages: Message[];
  updatedAt: number;
}

export interface AppConfig {
  apiKey: string;
  projectId: string;
  location: string;
  modelId: string;
  systemPrompt: string;
  safetyLevel: number; // 0: OFF, 1: Block Few, 2: Block Some, 3: Block Most
  temperature: number; 
  topP: number;
  maxOutputTokens: number;
  thinkingLevel: string; // 'OFF', 'LOW', 'MEDIUM', 'HIGH'
}
