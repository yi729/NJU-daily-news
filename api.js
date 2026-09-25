// 日报数据层：数据以静态 JSON 随站点一起发布（web/data/ 目录），前端不依赖站点函数。
// index.json 是归档列表，<日期>.json 是单日日报，search.json 是全部条目的搜索索引。
export class ApiError extends Error {
  constructor(message, code, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const MESSAGES = {
  network_error: '网络连接失败，请确认站点可访问后重试。',
  invalid_response: '数据文件读取失败，请稍后重试。',
  no_digest: '还没有这一期的日报。',
};

const DATA_ROOT = './data';
const MAX_DAYS = 60;
const SEARCH_DAYS = 30;
const SEARCH_LIMIT = 60;

async function getJson(path) {
  let response;
  try {
    response = await fetch(path, { cache: 'no-cache' });
  } catch {
    throw new ApiError(MESSAGES.network_error, 'network_error');
  }
  if (!response.ok) {
    throw new ApiError(MESSAGES.invalid_response, 'invalid_response', response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new ApiError(MESSAGES.invalid_response, 'invalid_response', response.status);
  }
}

export async function readIndex(limit = MAX_DAYS) {
  const data = await getJson(`${DATA_ROOT}/index.json`);
  return Array.isArray(data?.days) ? data.days.slice(0, limit) : [];
}

export async function readDay(date) {
  try {
    return await getJson(`${DATA_ROOT}/${date}.json`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(MESSAGES.no_digest, 'no_digest', 404);
    }
    throw error;
  }
}

export async function readLatest() {
  const days = await readIndex(1);
  if (!days.length) throw new ApiError(MESSAGES.no_digest, 'no_digest', 404);
  return readDay(days[0].date);
}

export async function readSearch(query, days = SEARCH_DAYS) {
  const index = await readIndex(MAX_DAYS);
  const window = new Set(index.slice(0, days).map((entry) => entry.date));
  const data = await getJson(`${DATA_ROOT}/search.json`);
  const needle = query.toLowerCase();
  const items = [];
  for (const item of Array.isArray(data?.items) ? data.items : []) {
    if (!window.has(item.date)) continue;
    const haystack = [item.title, item.summary, (item.tags || []).join(' '), item.source, item.column]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) continue;
    items.push(item);
    if (items.length >= SEARCH_LIMIT) break;
  }
  return { query, scannedDays: Math.min(days, index.length), items };
}
