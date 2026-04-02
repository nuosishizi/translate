import type { AppConfig, Message } from './types';

export const callGeminiStream = async (messages: Message[], config: AppConfig, onChunk: (text: string) => void): Promise<void> => {
  const url = `https://aiplatform.googleapis.com/v1/projects/${config.projectId}/locations/${config.location}/publishers/google/models/${config.modelId}:streamGenerateContent?alt=sse&key=${config.apiKey}`;
  
  const payload: any = {
    contents: messages,
    generationConfig: {
      temperature: config.temperature,
      topP: config.topP,
      maxOutputTokens: config.maxOutputTokens,
    }
  };

  if (config.thinkingLevel && config.thinkingLevel !== 'OFF') {
    payload.generationConfig.thinkingConfig = {
      thinkingLevel: config.thinkingLevel
    };
  }

  if (config.systemPrompt && config.systemPrompt.trim() !== '') {
    payload.systemInstruction = {
      parts: [{text: config.systemPrompt}]
    };
  }

  const thresholds = [
    "BLOCK_NONE", 
    "BLOCK_ONLY_HIGH", 
    "BLOCK_MEDIUM_AND_ABOVE", 
    "BLOCK_LOW_AND_ABOVE"
  ];
  
  const safetyCategories = [
    "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_DANGEROUS_CONTENT",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    "HARM_CATEGORY_HARASSMENT"
  ];

  const safetyLevelIndex = Math.min(Math.max(config.safetyLevel, 0), 3);
  payload.safetySettings = safetyCategories.map(category => ({
    category,
    threshold: thresholds[safetyLevelIndex]
  }));

  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  };

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    let errMsg = errorText;
    try {
      const errJson = JSON.parse(errorText);
      if(errJson.error && errJson.error.message) errMsg = errJson.error.message;
    } catch(e) {}
    throw new Error(`请求失败: ${response.status} ${response.statusText} - ${errMsg}`);
  }

  if (!response.body) throw new Error('当前浏览器不支持流式读取');

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf8");
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    
    let boundary = buffer.indexOf('\n');
    while (boundary !== -1) {
      const line = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 1);
      boundary = buffer.indexOf('\n');

      if (line.startsWith('data: ')) {
        const dataStr = line.substring(6).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const data = JSON.parse(dataStr);
          if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts.length > 0) {
             const chunkText = data.candidates[0].content.parts.map((p: any) => p.text || '').join('');
             fullText += chunkText;
             onChunk(fullText);
          }
        } catch (e) {
          // 忽略不完整的 JSON 或解析错误（SSE 可能会发生）
        }
      }
    }
  }
};
