/**
 * Toonflow AI供应商模板 - Agnes AI
 * @version 2.2
 */

// ============================================================
// 类型定义
// ============================================================

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceList?: Extract<ReferenceList, { type: "audio" }>[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// 全局声明
// ============================================================

declare const axios: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>;
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "agnes-ai",
  version: "2.2",
  author: "Toonflow",
  name: "Agnes AI",
  description: "Agnes AI 全模态 API - 文本、图像、视频生成，支持多模态输入\n[前往平台](https://agnes-ai.com/)",
  inputs: [
    { key: "apiKey", label: "API Key", type: "password", required: true },
    { key: "baseUrl", label: "Base URL", type: "url", required: true, placeholder: "https://apihub.agnes-ai.com/v1" },
  ],
  inputValues: { apiKey: "", baseUrl: "https://apihub.agnes-ai.com/v1" },
  models: [
    { name: "Agnes 2.0 Flash", modelName: "agnes-2.0-flash", type: "text", think: true },
    { name: "Agnes 1.5 Flash", modelName: "agnes-1.5-flash", type: "text", think: false },
    { name: "Agnes Image 2.1 Flash", modelName: "agnes-image-2.1-flash", type: "image", mode: ["text", "singleImage"] },
    { name: "Agnes Image 2.0 Flash", modelName: "agnes-image-2.0-flash", type: "image", mode: ["text", "singleImage", "multiReference"] },
    {
      name: "Agnes Video V2.0",
      modelName: "agnes-video-v2.0",
      type: "video",
      mode: ["text", "singleImage", "startEndRequired", "endFrameOptional"],
      audio: true,
      durationResolutionMap: [
        { duration: [5, 10, 18], resolution: ["768x1152", "1152x768"] },
        { duration: [5, 10], resolution: ["1024x1024"] },
      ],
    },
  ],
};

// ============================================================
// 辅助工具
// ============================================================

function getBaseUrl() {
  return vendor.inputValues.baseUrl || "https://apihub.agnes-ai.com/v1";
}

function getHeaders() {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 API Key");
  return {
    Authorization: `Bearer ${vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  };
}

function aspectRatioToSize(aspectRatio: `${number}:${number}`, baseSize: "1K" | "2K" | "4K"): { width: number; height: number } {
  const [w, h] = aspectRatio.split(":").map(Number);
  let baseWidth = 1024;
  if (baseSize === "2K") baseWidth = 1536;
  if (baseSize === "4K") baseWidth = 2048;
  return { width: baseWidth, height: Math.round(baseWidth * (h / w)) };
}

/**
 * 提取有头 base64 字符串
 */
function extractBase64WithHead(ref: ReferenceList): string {
  if (!ref || !ref.base64) return "";
  return ref.base64.startsWith("data:") ? ref.base64 : `data:image/png;base64,${ref.base64}`;
}

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return createOpenAI({ baseURL: getBaseUrl(), apiKey }).chat(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  logger("开始生成图片...");
  const { prompt, referenceList, size, aspectRatio } = config;
  const { width, height } = aspectRatioToSize(aspectRatio, size);
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  // 收集有效的图生图参考
  const imageRefs = (referenceList || []).filter((r) => r && r.base64);
  const hasImageRefs = imageRefs.length > 0;

  // 处理空 prompt 问题：分镜模式可能没有自动生成提示词
  const effectivePrompt = (prompt || "").trim();
  // 图生图模式：无提示词时给一个默认值，让 API 能正常处理参考图
  // 文生图模式：无提示词时抛明确错误
  const finalPrompt = effectivePrompt || (hasImageRefs ? "Transform this image" : "");
  if (!finalPrompt) {
    throw new Error("缺少提示词（prompt），请先生成或输入提示词");
  }

  const requestBody: any = {
    model: model.modelName,
    prompt: finalPrompt,
    size: `${width}x${height}`,
  };

  if (hasImageRefs) {
    // 图生图模式：image 必须在 extra_body 内部！
    // 参考文档第3-5节的 curl 示例：
    // https://agnes-ai.com/doc/agnes-image-21-flash#heading-5-图生图data-uri-base64-输入
    requestBody.extra_body = {
      image: imageRefs.map((r) => extractBase64WithHead(r)),
      response_format: "b64_json",
    };
  } else {
    // 文生图模式
    requestBody.return_base64 = true;
  }

  logger("发送图片生成请求...");
  const response = await axios.post(`${baseUrl}/images/generations`, requestBody, { headers });

  // 检查 API 错误响应
  if (response.data?.error) {
    throw new Error(`API 错误: ${JSON.stringify(response.data.error)}`);
  }

  // 处理返回结果 - 同时兼容 b64_json 和 url
  const result = response.data?.data?.[0];
  if (!result) throw new Error("未收到有效的图片数据");

  // 优先使用 b64_json，其次使用 url
  if (result.b64_json) {
    logger("图片生成成功，返回 base64 数据...");
    return result.b64_json.startsWith("data:") ? result.b64_json : `data:image/png;base64,${result.b64_json}`;
  }

  if (result.url) {
    logger("图片生成成功，URL 转 base64...");
    return await urlToBase64(result.url);
  }

  throw new Error("未收到有效的图片数据");
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  logger("开始生成视频...");
  const { prompt, duration, aspectRatio, referenceList, audio, mode } = config;
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  let width = 1152;
  let height = 768;
  if (aspectRatio === "9:16") {
    width = 768;
    height = 1152;
  }

  const frameRate = 24;
  let numFrames = 121;
  if (duration >= 10) numFrames = 241;
  if (duration >= 18) numFrames = 441;
  numFrames = Math.min(numFrames, 441);
  numFrames = Math.max(121, numFrames);
  numFrames = Math.floor(numFrames / 8) * 8 + 1;

  // 处理图片参考
  // 参考文档：https://agnes-ai.com/doc/agnes-video-v20
  const imageRefs = (referenceList || [])
    .filter((r) => r && r.type === "image" && r.base64)
    .map((r) => {
      // 视频 API 不接受 data: 前缀，需提取纯 base64
      const b64 = extractBase64WithHead(r);
      return b64.replace(/^data:image\/\w+;base64,/, '');
    });

  const hasImageRefs = imageRefs.length > 0;

  // 处理空 prompt 问题：分镜模式可能没有自动生成提示词
  // 如果有图片参考（如图生视频/关键帧模式），提供默认提示词
  // 如果没有图片参考且无提示词，抛明确错误
  const effectivePrompt = (prompt || "").trim();
  const finalPrompt = effectivePrompt || (hasImageRefs ? "Generate a video from this image" : "");
  if (!finalPrompt) {
    throw new Error("缺少提示词（prompt），请先生成或输入提示词");
  }

  const requestBody: any = {
    model: "agnes-video-v2.0",
    prompt: finalPrompt,
    width,
    height,
    num_frames: numFrames,
    frame_rate: frameRate,
  };

  if (hasImageRefs) {
    if (imageRefs.length >= 2) {
      // 多图模式 → image 为数组，放在 extra_body 内
      requestBody.extra_body = {
        image: imageRefs,
        mode: "keyframes",
      };
    } else {
      // 单图模式 → image 为字符串，放在顶层
      requestBody.image = imageRefs[0];
      requestBody.mode = "ti2vid";
    }
  }

  logger("提交视频生成任务...");
  const createResponse = await axios.post(`${baseUrl}/videos`, requestBody, { headers });
  const taskId = createResponse.data.id;
  logger(`任务已创建，任务 ID: ${taskId}`);

  const pollResult = await pollTask(async () => {
    logger("轮询任务状态...");
    const statusResponse = await axios.get(`${baseUrl}/videos/${taskId}`, { headers });
    const status = statusResponse.data.status;

    if (status === "completed") {
      // 文档中视频 URL 字段为 remixed_from_video_id
      const videoUrl = statusResponse.data.remixed_from_video_id || statusResponse.data.video_url;
      return { completed: true, data: videoUrl };
    } else if (status === "failed" || status === "error") {
      return { completed: true, error: `视频生成失败: ${JSON.stringify(statusResponse.data)}` };
    }
    return { completed: false };
  }, 5000, 600000);

  if (pollResult.error) throw new Error(pollResult.error);

  logger("视频生成成功，转换为 base64...");
  return await urlToBase64(pollResult.data!);
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "2.2", notice: "" };
};

const updateVendor = async (): Promise<string> => {
  return "";
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

export {};