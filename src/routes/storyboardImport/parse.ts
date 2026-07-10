import express from "express";
import compressing from "compressing";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

type RoleSpec = {
  name: string;
  age?: string;
  appearance?: string;
  costume?: string;
  personality?: string;
};

type SceneSpec = {
  name: string;
  time?: string;
  color?: string;
  elements?: string;
  atmosphere?: string;
};

type MusicSpec = {
  paragraph?: string;
  shotNo?: string;
  duration?: number;
  style?: string;
  sound?: string;
};

type SubtitleSpec = Record<string, string>;

type AssetStats = {
  roles: number;
  scenes: number;
  tools: number;
  total: number;
};

type ImportMeta = {
  project?: {
    productionSpec?: string;
    totalDuration?: number;
    theme?: string;
  };
  roles?: RoleSpec[];
  scenes?: SceneSpec[];
  music?: MusicSpec[];
  subtitle?: SubtitleSpec;
  assetStats?: AssetStats;
};

type ImportRow = {
  shotNo?: string;
  index?: number;
  prompt: string;
  duration: number;
  track: string;
  state: string;
  src: string | null;
  videoDesc: string;
  shouldGenerateImage: number;
  associateAssetsIds: number[];
  roleNames: string[];
  sceneNames: string[];
  toolNames: string[];
  shotSize?: string;
  cameraMove?: string;
  scene?: string;
  visualContent?: string;
  dialogue?: string;
  audio?: string;
  props?: string;
  remark?: string;
};

type ParsedImport = {
  data: ImportRow[];
  meta: ImportMeta;
  warnings: string[];
};

type DurationIssue = "missing" | "invalid";
const durationIssues = new WeakMap<ImportRow, DurationIssue>();

type StandardStoryboardRecord = {
  shotNo?: string;
  duration?: unknown;
  shotSize?: string;
  cameraMove?: string;
  scene?: string;
  visualContent?: string;
  dialogue?: string;
  audio?: string;
  props?: string;
  remark?: string;
  prompt?: string;
  videoDesc?: string;
  track?: string;
  shouldGenerateImage?: unknown;
  associateAssetsIds?: unknown;
  roleNames?: unknown;
  sceneNames?: unknown;
  toolNames?: unknown;
  state?: unknown;
  src?: unknown;
};

const headerAliases: Record<keyof Pick<ImportRow, "prompt" | "duration" | "track" | "videoDesc" | "shouldGenerateImage" | "roleNames" | "sceneNames" | "toolNames">, string[]> = {
  prompt: ["prompt", "分镜图提示词", "图片提示词", "镜头提示词", "画面描述", "镜头描述", "画面内容"],
  duration: ["duration", "时长", "秒数", "推荐时长", "视频时长"],
  track: ["track", "分组", "轨道", "场次", "场景分组", "视频分组", "场景"],
  videoDesc: ["videoDesc", "视频描述", "视频画面描述", "分镜描述", "内容", "画面内容"],
  shouldGenerateImage: ["shouldGenerateImage", "是否生成分镜图", "生成分镜图", "需要生成图片", "生成图片"],
  roleNames: ["roleNames", "roles", "角色", "人物"],
  sceneNames: ["sceneNames", "scenes", "场景", "地点"],
  toolNames: ["toolNames", "tools", "props", "道具", "物品", "道具/陈设"],
};

const storyboardFieldMap: Record<string, keyof StandardStoryboardRecord> = {
  镜号: "shotNo",
  时长: "duration",
  景别: "shotSize",
  镜头运动: "cameraMove",
  场景: "scene",
  画面内容: "visualContent",
  "台词/旁白": "dialogue",
  台词: "dialogue",
  旁白: "dialogue",
  "音效/配乐": "audio",
  音效: "audio",
  配乐: "audio",
  "道具/陈设": "props",
  道具: "props",
  备注: "remark",
};

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/\*\*/g, "")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.map(cleanText).filter(Boolean))];
  const text = cleanText(value);
  if (!text) return [];
  return [
    ...new Set(
      text
        .split(/[、,，|；;\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function splitContextList(value: unknown): string[] {
  const text = cleanText(value);
  if (!text) return [];
  const result: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of text) {
    if (char === "（" || char === "(" || char === "【" || char === "[") depth += 1;
    if (char === "）" || char === ")" || char === "】" || char === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[、,，|；;\n]/.test(char)) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) result.push(current.trim());
  return unique(result);
}

function normalizeToolName(value: string): string {
  const name = cleanText(value).replace(/^(?:道具|陈设)[：:]\s*/, "").replace(/\s*[（(【\[].*?[）)】\]]\s*$/u, "").trim();
  return name || cleanText(value);
}

function pickKnownScenes(scene: string, scenes: SceneSpec[] = []): string[] {
  if (!scene) return [];
  const matched = scenes
    .map((item) => cleanText(item.name))
    .filter((name) => name && (scene.includes(name) || name.includes(scene)));
  return matched.length ? unique(matched) : [scene];
}

function getAliasValue(record: Record<string, unknown>, key: keyof typeof headerAliases) {
  const alias = headerAliases[key].find((name) => record[name] != null && cleanText(record[name]) !== "");
  return alias ? record[alias] : undefined;
}

function inspectDuration(value: unknown, fallback = 3): { value: number; issue?: DurationIssue } {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? { value } : { value: fallback, issue: "invalid" };
  }
  const text = cleanText(value);
  if (!text) return { value: fallback, issue: "missing" };
  if (/-\s*\d/.test(text)) return { value: fallback, issue: "invalid" };
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return { value: fallback, issue: "invalid" };
  const duration = Number(match[0]);
  return Number.isFinite(duration) && duration > 0 ? { value: duration } : { value: fallback, issue: "invalid" };
}

function parseDuration(value: unknown, fallback = 3): number {
  return inspectDuration(value, fallback).value;
}

function toShouldGenerateImage(value: unknown): number {
  if (typeof value === "number") return value ? 1 : 0;
  if (typeof value !== "string") return 1;
  return ["否", "不生成", "false", "0", "no", "n"].includes(value.trim().toLowerCase()) ? 0 : 1;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function pickKnownRoles(text: string, roles: RoleSpec[] = []): string[] {
  const roleNames = roles.map((item) => cleanText(item.name)).filter(Boolean);
  if (roleNames.length) return unique(roleNames.filter((name) => text.includes(name)));
  const speakers = [...text.matchAll(/(?:^|\n)([\u4e00-\u9fa5A-Za-z0-9_]{2,12})(?:[（(][^）)]*[）)])?[：:]/g)]
    .map((match) => match[1])
    .filter((name) => name && !["旁白", "画外音"].includes(name));
  return unique(speakers);
}

function buildVideoDesc(record: StandardStoryboardRecord): string {
  const lines = [
    record.shotNo ? `镜号：${record.shotNo}` : "",
    record.duration ? `时长：${cleanText(record.duration)}${/^\d+(?:\.\d+)?$/.test(cleanText(record.duration)) ? "秒" : ""}` : "",
    record.shotSize ? `景别：${record.shotSize}` : "",
    record.cameraMove ? `镜头运动：${record.cameraMove}` : "",
    record.scene ? `场景：${record.scene}` : "",
    record.visualContent ? `画面内容：${record.visualContent}` : "",
    record.dialogue ? `台词/旁白：${record.dialogue}` : "",
    record.audio ? `音效/配乐：${record.audio}` : "",
    record.props ? `道具/陈设：${record.props}` : "",
    record.remark ? `备注：${record.remark}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function normalizeRow(record: Record<string, unknown>, index: number): ImportRow {
  const videoDesc = cleanText(getAliasValue(record, "videoDesc") ?? getAliasValue(record, "prompt") ?? "");
  const prompt = cleanText(getAliasValue(record, "prompt") ?? videoDesc);
  const durationResult = inspectDuration(getAliasValue(record, "duration"));
  const track = cleanText(getAliasValue(record, "track") ?? "默认分组") || "默认分组";
  const shouldGenerateImage = toShouldGenerateImage(getAliasValue(record, "shouldGenerateImage"));
  const associateAssetsIds = Array.isArray(record.associateAssetsIds) ? record.associateAssetsIds.map(Number).filter((id) => !Number.isNaN(id)) : [];

  const row: ImportRow = {
    prompt: prompt || `分镜${index + 1}`,
    duration: durationResult.value,
    track,
    state: cleanText(record.state ?? "未生成") || "未生成",
    src: typeof record.src === "string" && record.src ? record.src : null,
    videoDesc: videoDesc || prompt || `分镜${index + 1}`,
    shouldGenerateImage,
    associateAssetsIds,
    roleNames: splitList(getAliasValue(record, "roleNames")),
    sceneNames: splitList(getAliasValue(record, "sceneNames")),
    toolNames: splitList(getAliasValue(record, "toolNames")),
  };
  if (durationResult.issue) durationIssues.set(row, durationResult.issue);
  return row;
}

function normalizeStandardRow(record: StandardStoryboardRecord, index: number, meta: ImportMeta): ImportRow {
  const durationResult = inspectDuration(record.duration);
  const visualContent = cleanText(record.visualContent ?? record.videoDesc ?? record.prompt ?? "");
  const dialogue = cleanText(record.dialogue ?? "");
  const props = cleanText(record.props ?? "");
  const scene = cleanText(record.scene ?? "");
  const videoDesc = buildVideoDesc({
    ...record,
    visualContent,
    dialogue,
    props,
    scene,
    shotSize: cleanText(record.shotSize ?? ""),
    cameraMove: cleanText(record.cameraMove ?? ""),
    audio: cleanText(record.audio ?? ""),
    remark: cleanText(record.remark ?? ""),
  });
  const roleNames = splitList(record.roleNames);
  const sceneNames = splitList(record.sceneNames);
  const toolNames = splitList(record.toolNames);
  const roleText = [visualContent, dialogue, props].join("\n");
  const parsedToolNames = splitContextList(props).map(normalizeToolName).filter(Boolean);

  const row: ImportRow = {
    shotNo: cleanText(record.shotNo ?? "") || undefined,
    index: index + 1,
    prompt: cleanText(record.prompt ?? visualContent) || `分镜${index + 1}`,
    duration: durationResult.value,
    track: cleanText(record.track ?? scene) || "默认分组",
    state: cleanText(record.state ?? "未生成") || "未生成",
    src: typeof record.src === "string" && record.src ? record.src : null,
    videoDesc: cleanText(record.videoDesc ?? videoDesc) || visualContent || `分镜${index + 1}`,
    shouldGenerateImage: toShouldGenerateImage(record.shouldGenerateImage),
    associateAssetsIds: Array.isArray(record.associateAssetsIds) ? record.associateAssetsIds.map(Number).filter((id) => !Number.isNaN(id)) : [],
    roleNames: unique([...roleNames, ...pickKnownRoles(roleText, meta.roles)]),
    sceneNames: unique([...sceneNames, ...pickKnownScenes(scene, meta.scenes)]),
    toolNames: unique([...toolNames, ...parsedToolNames]),
    shotSize: cleanText(record.shotSize ?? "") || undefined,
    cameraMove: cleanText(record.cameraMove ?? "") || undefined,
    scene: scene || undefined,
    visualContent: visualContent || undefined,
    dialogue: dialogue || undefined,
    audio: cleanText(record.audio ?? "") || undefined,
    props: props || undefined,
    remark: cleanText(record.remark ?? "") || undefined,
  };
  if (durationResult.issue) durationIssues.set(row, durationResult.issue);
  return row;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuote && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    if ((char === "," || char === "\t") && !inQuote) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current.trim());
  return result;
}

function parseTable(content: string): ParsedImport {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { data: [], meta: {}, warnings: ["未解析到有效分镜数据"] };

  const header = parseCsvLine(lines[0]);
  const hasKnownHeader = header.some((name) => Object.values(headerAliases).flat().includes(name));
  if (!hasKnownHeader) {
    return {
      data: lines.map((line, index) => normalizeRow({ videoDesc: line, prompt: line }, index)),
      meta: {},
      warnings: ["未识别到标准表头，已按逐行画面描述导入"],
    };
  }

  return {
    data: lines.slice(1).map((line, index) => {
      const values = parseCsvLine(line);
      const record = header.reduce<Record<string, unknown>>((result, name, columnIndex) => {
        result[name] = values[columnIndex] ?? "";
        return result;
      }, {});
      return normalizeRow(record, index);
    }),
    meta: {},
    warnings: [],
  };
}

function matchSection(content: string, start: string, end?: string): string {
  const startIndex = content.indexOf(start);
  if (startIndex < 0) return "";
  const rest = content.slice(startIndex + start.length);
  if (!end) return rest;
  const endIndex = rest.indexOf(end);
  return endIndex >= 0 ? rest.slice(0, endIndex) : rest;
}

function parseKeyValueBlocks(section: string, startField: string, fields: Record<string, string>): Record<string, string>[] {
  const blocks: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  let currentKey = "";

  section.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const match = line.match(/^([^：:]{1,24})[：:](.*)$/);
    const rawKey = match ? match[1].trim() : "";
    const rawValue = match ? match[2].trim() : "";
    const numberedStartField = rawKey.match(new RegExp(`^${startField}\\s*[一二三四五六七八九十百零〇0-9]+$`));
    if (rawKey === startField || numberedStartField) {
      if (current) blocks.push(current);
      const fieldKey = fields[startField] ?? startField;
      current = { [fieldKey]: rawValue };
      currentKey = fieldKey;
      return;
    }
    if (current && rawKey) {
      const normalizedKey = rawKey.replace(/^[一二三四五六七八九十百零〇0-9]+[.、]\s*/, "");
      const fieldKey = fields[rawKey] ?? fields[normalizedKey];
      if (fieldKey) {
        current[fieldKey] = rawValue;
        currentKey = fieldKey;
        return;
      }
    }
    if (current && currentKey) {
      current[currentKey] = `${current[currentKey] ?? ""}\n${line}`.trim();
    }
  });

  if (current) blocks.push(current);
  return blocks;
}

function parseProjectMeta(content: string): ImportMeta["project"] {
  const productionSpec = content.match(/(?:\*\*)?制作规格(?:\*\*)?[：:]\s*([^\n]+)/)?.[1];
  const totalDuration = content.match(/(?:\*\*)?总时长(?:\*\*)?[：:]\s*([^\n]+)/)?.[1];
  const theme = content.match(/(?:\*\*)?主题(?:\*\*)?[：:]\s*([^\n]+)/)?.[1];
  return {
    productionSpec: cleanText(productionSpec ?? "") || undefined,
    totalDuration: totalDuration ? parseDuration(totalDuration, 0) : undefined,
    theme: cleanText(theme ?? "") || undefined,
  };
}

function parseTxtStandard(content: string): ParsedImport {
  const meta: ImportMeta = { project: parseProjectMeta(content) };
  const storyboardSection = matchSection(content, "一、分镜明细", "二、角色形象参考");
  const roleSection = matchSection(content, "二、角色形象参考", "三、场景美术参考");
  const sceneSection = matchSection(content, "三、场景美术参考", "四、音乐音效总览");
  const musicSection = matchSection(content, "四、音乐音效总览", "五、台词语速核对");
  const subtitleSection = matchSection(content, "六、字幕制作说明");

  meta.roles = parseKeyValueBlocks(roleSection, "角色", {
    角色: "name",
    年龄: "age",
    外貌特征: "appearance",
    服装: "costume",
    性格关键词: "personality",
  }).map((item) => ({ name: item.name, age: item.age, appearance: item.appearance, costume: item.costume, personality: item.personality }));

  meta.scenes = parseKeyValueBlocks(sceneSection, "场景", {
    场景: "name",
    时间: "time",
    色调: "color",
    元素: "elements",
    氛围: "atmosphere",
  })
    .map((item) => ({ name: cleanText(item.name), time: item.time, color: item.color, elements: item.elements, atmosphere: item.atmosphere }))
    .filter((item) => item.name);

  meta.music = parseKeyValueBlocks(musicSection, "段落", {
    段落: "paragraph",
    镜号: "shotNo",
    时长: "duration",
    音乐风格: "style",
    主要音效: "sound",
  }).map((item) => ({ paragraph: item.paragraph, shotNo: item.shotNo, duration: parseDuration(item.duration, 0), style: item.style, sound: item.sound }));

  meta.subtitle = parseKeyValueBlocks(subtitleSection, "字体", {
    字体: "font",
    大小: "size",
    位置: "position",
    颜色: "color",
    同步: "sync",
  })[0];

  const records = parseKeyValueBlocks(storyboardSection, "镜号", {
    镜号: "shotNo",
    时长: "duration",
    景别: "shotSize",
    镜头运动: "cameraMove",
    场景: "scene",
    画面内容: "visualContent",
    "台词/旁白": "dialogue",
    "音效/配乐": "audio",
    "道具/陈设": "props",
    备注: "remark",
  }) as StandardStoryboardRecord[];

  return {
    data: records.map((record, index) => normalizeStandardRow(record, index, meta)),
    meta,
    warnings: records.length ? [] : ["未在 TXT 标准格式中解析到分镜明细"],
  };
}

function parseMarkdownTableRows(tableLines: string[]): Record<string, string>[] {
  const rows = tableLines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cleanText(cell)));
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(2).map((values) =>
    header.reduce<Record<string, string>>((result, name, index) => {
      result[name] = values[index] ?? "";
      return result;
    }, {}),
  );
}

function collectMarkdownTables(content: string): Record<string, string>[][] {
  const tables: string[][] = [];
  let current: string[] = [];
  content.split(/\r?\n/).forEach((line) => {
    if (line.trim().startsWith("|")) {
      current.push(line);
      return;
    }
    if (current.length) {
      tables.push(current);
      current = [];
    }
  });
  if (current.length) tables.push(current);
  return tables.map(parseMarkdownTableRows).filter((table) => table.length);
}

function parseMarkdownScenes(content: string): SceneSpec[] {
  const section = matchSection(content, "## 场景美术参考", "---");
  const scenes: SceneSpec[] = [];
  let current: SceneSpec | null = null;
  section.split(/\r?\n/).forEach((rawLine) => {
    const line = cleanText(rawLine.replace(/^[-*]\s*/, ""));
    const title = line.match(/^#{1,6}\s*场景\d*[：:](.+)$/);
    if (title) {
      if (current) scenes.push(current);
      current = { name: cleanText(title[1]) };
      return;
    }
    const kv = line.match(/^([^：:]+)[：:](.*)$/);
    if (!current || !kv) return;
    const key = kv[1].trim();
    const value = cleanText(kv[2]);
    if (key === "时间") current.time = value;
    if (key === "色调") current.color = value;
    if (key === "元素") current.elements = value;
    if (key === "氛围") current.atmosphere = value;
  });
  if (current) scenes.push(current);
  return scenes;
}

function tableRecordToStandard(record: Record<string, string>): StandardStoryboardRecord {
  return Object.entries(record).reduce<StandardStoryboardRecord>((result, [key, value]) => {
    const field = storyboardFieldMap[key];
    if (field) result[field] = value;
    return result;
  }, {});
}

function parseMarkdown(content: string): ParsedImport {
  const meta: ImportMeta = { project: parseProjectMeta(content), scenes: parseMarkdownScenes(content) };
  const tables = collectMarkdownTables(content);
  const storyboardRows: StandardStoryboardRecord[] = [];

  tables.forEach((table) => {
    const first = table[0] ?? {};
    const columns = Object.keys(first);
    if (columns.includes("镜号") && columns.includes("画面内容")) {
      storyboardRows.push(...table.map(tableRecordToStandard));
    }
    if (columns.includes("角色") && columns.includes("外貌特征")) {
      meta.roles = table.map((item) => ({
        name: cleanText(item["角色"]),
        age: cleanText(item["年龄"]),
        appearance: cleanText(item["外貌特征"]),
        costume: cleanText(item["服装"]),
        personality: cleanText(item["性格关键词"]),
      }));
    }
    if (columns.includes("段落") && columns.includes("音乐风格")) {
      meta.music = table.map((item) => ({
        paragraph: cleanText(item["段落"]),
        shotNo: cleanText(item["镜号"]),
        duration: parseDuration(item["时长"], 0),
        style: cleanText(item["音乐风格"]),
        sound: cleanText(item["主要音效"]),
      }));
    }
  });

  return {
    data: storyboardRows.map((record, index) => normalizeStandardRow(record, index, meta)),
    meta,
    warnings: storyboardRows.length ? [] : ["未在 Markdown 表格中解析到分镜明细"],
  };
}

function xmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractCellText(cellXml: string): string {
  const paragraphs = cellXml.match(/<w:p[\s\S]*?<\/w:p>/g) ?? [cellXml];
  return paragraphs
    .map((paragraph) => [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => xmlDecode(match[1])).join(""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseDocxTables(documentXml: string): Record<string, string>[][] {
  const tables = documentXml.match(/<w:tbl[\s\S]*?<\/w:tbl>/g) ?? [];
  return tables
    .map((tableXml) => {
      const rows = (tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? [])
        .map((rowXml) => (rowXml.match(/<w:tc[\s\S]*?<\/w:tc>/g) ?? []).map(extractCellText))
        .filter((row) => row.some(Boolean));
      if (rows.length < 2) return [];
      const header = rows[0].map(cleanText);
      return rows.slice(1).map((values) =>
        header.reduce<Record<string, string>>((result, name, index) => {
          result[name] = cleanText(values[index] ?? "");
          return result;
        }, {}),
      );
    })
    .filter((table) => table.length);
}

async function parseDocx(buffer: Buffer): Promise<ParsedImport> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "toonflow-docx-"));
  try {
    await compressing.zip.uncompress(buffer, tmpDir);
    const documentXml = await readFile(path.join(tmpDir, "word", "document.xml"), "utf8");
    const tables = parseDocxTables(documentXml);
    const meta: ImportMeta = {};
    const storyboardRows: StandardStoryboardRecord[] = [];

    tables.forEach((table) => {
      const first = table[0] ?? {};
      const columns = Object.keys(first);
      if (columns.includes("项目") && columns.includes("内容")) {
        table.forEach((item) => {
          const key = cleanText(item["项目"]);
          const value = cleanText(item["内容"]);
          meta.project = meta.project ?? {};
          if (key === "制作规格") meta.project.productionSpec = value;
          if (key === "总时长") meta.project.totalDuration = parseDuration(value, 0);
          if (key === "主题") meta.project.theme = value;
        });
      }
      if (columns.includes("镜号") && columns.includes("画面内容")) storyboardRows.push(...table.map(tableRecordToStandard));
      if (columns.includes("角色") && columns.includes("外貌特征")) {
        meta.roles = table.map((item) => ({ name: cleanText(item["角色"]), age: cleanText(item["年龄"]), appearance: cleanText(item["外貌特征"]), costume: cleanText(item["服装"]), personality: cleanText(item["性格关键词"]) }));
      }
      if (columns.includes("场景") && columns.includes("色调")) {
        meta.scenes = table.map((item) => ({ name: cleanText(item["场景"]), time: cleanText(item["时间"]), color: cleanText(item["色调"]), elements: cleanText(item["元素"]), atmosphere: cleanText(item["氛围"]) }));
      }
      if (columns.includes("段落") && columns.includes("音乐风格")) {
        meta.music = table.map((item) => ({ paragraph: cleanText(item["段落"]), shotNo: cleanText(item["镜号"]), duration: parseDuration(item["时长"], 0), style: cleanText(item["音乐风格"]), sound: cleanText(item["主要音效"]) }));
      }
      if (columns.includes("项目") && columns.includes("说明") && !meta.subtitle) {
        meta.subtitle = table.reduce<SubtitleSpec>((result, item) => {
          result[cleanText(item["项目"])] = cleanText(item["说明"]);
          return result;
        }, {});
      }
    });

    return {
      data: storyboardRows.map((record, index) => normalizeStandardRow(record, index, meta)),
      meta,
      warnings: storyboardRows.length ? [] : ["未在 DOCX 表格中解析到分镜明细"],
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function decodeBase64Payload(base64: string): Buffer {
  const payload = base64.includes(",") ? base64.split(",").pop()! : base64;
  return Buffer.from(payload, "base64");
}

function decodeBase64Content(base64: string) {
  return decodeBase64Payload(base64).toString("utf8").replace(/^\uFEFF/, "");
}

function mergeWarnings(parsed: ParsedImport): ParsedImport {
  const warnings = [...parsed.warnings];
  parsed.data.forEach((row, index) => {
    if (!row.shotNo) warnings.push(`第 ${index + 1} 条分镜缺少镜号`);
    const durationIssue = durationIssues.get(row);
    if (durationIssue === "missing") warnings.push(`第 ${index + 1} 条分镜缺少时长，已使用默认 3 秒`);
    if (durationIssue === "invalid") warnings.push(`第 ${index + 1} 条分镜时长异常，已使用默认 3 秒`);
    if (!row.visualContent && !row.videoDesc) warnings.push(`第 ${index + 1} 条分镜缺少画面内容`);
  });

  const roleNames = unique((parsed.meta.roles ?? []).map((item) => item.name));
  const sceneNames = unique((parsed.meta.scenes ?? []).map((item) => item.name));
  const toolNames = unique(parsed.data.flatMap((row) => row.toolNames));
  const assetStats: AssetStats = {
    roles: roleNames.length,
    scenes: sceneNames.length,
    tools: toolNames.length,
    total: roleNames.length + sceneNames.length + toolNames.length,
  };
  if (assetStats.total === 0) warnings.push("阻断警告：未解析到任何原始资产（角色/场景/道具），请补充资产信息后再提交");
  return { ...parsed, meta: { ...parsed.meta, assetStats }, warnings: unique(warnings) };
}

async function parseContent(params: { content?: string; base64?: string; format?: string; filename?: string; mimeType?: string }): Promise<ParsedImport> {
  const { content, base64, format = "auto", filename = "", mimeType = "" } = params;
  const lowerName = filename.toLowerCase();
  const isDocx = format === "docx" || lowerName.endsWith(".docx") || mimeType.includes("wordprocessingml.document");
  if (isDocx) {
    if (!base64) return { data: [], meta: {}, warnings: ["DOCX 文件需要以 base64 方式上传"] };
    return mergeWarnings(await parseDocx(decodeBase64Payload(base64)));
  }

  const text = (typeof base64 === "string" && base64 ? decodeBase64Content(base64) : content ?? "").trim();
  if (!text) return { data: [], meta: {}, warnings: ["未解析到有效分镜数据"] };
  if (format === "json" || text.startsWith("[")) {
    const data = JSON.parse(text) as Record<string, unknown>[];
    return mergeWarnings({ data: data.map((item, index) => normalizeRow(item, index)), meta: {}, warnings: [] });
  }
  if (format === "txt-standard" || lowerName.endsWith(".txt") || text.includes("一、分镜明细")) return mergeWarnings(parseTxtStandard(text));
  if (format === "markdown" || lowerName.endsWith(".md") || /^#\s+/m.test(text) || text.includes("| 镜号 |")) return mergeWarnings(parseMarkdown(text));
  return mergeWarnings(parseTable(text));
}

export default router.post(
  "/",
  validateFields({
    content: z.string().optional(),
    base64: z.string().optional(),
    filename: z.string().optional(),
    mimeType: z.string().optional(),
    format: z.enum(["auto", "json", "csv", "text", "txt-standard", "markdown", "docx"]).optional(),
  }),
  async (req, res) => {
    try {
      const parsed = await parseContent(req.body);
      res.status(200).send(
        success({
          data: parsed.data,
          meta: parsed.meta,
          total: parsed.data.length,
          warnings: parsed.data.length ? parsed.warnings : parsed.warnings.length ? parsed.warnings : ["未解析到有效分镜数据"],
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "分镜表解析失败";
      res.status(400).send(error(message));
    }
  },
);
