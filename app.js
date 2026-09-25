import { ApiError, readDay, readIndex, readLatest, readSearch, readWeek, readWindow } from './api.js';

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const view = document.getElementById('view');
const state = {
  day: null,
  daySource: null,
  days: null,
  filters: { q: '', source: '', tag: '', star: false },
  search: { q: '', items: null, scannedDays: 0 },
  week: { data: null, items: null },
  token: 0,
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function parseDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const weekday = (value) => WEEK[parseDate(value).getDay()];
const monthDay = (value) => `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`;
const slashDate = (value) => value.slice(5).replace('-', '/');

function todayString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  if (parts[0] === 'archive') return { name: 'archive' };
  if (parts[0] === 'week') return { name: 'week' };
  if (parts[0] === 'search') return { name: 'search', q: params.get('q') || '' };
  if (parts[0] === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(parts[1] || '')) {
    return { name: 'day', date: parts[1] };
  }
  return { name: 'today' };
}

function setHash(path) {
  if (location.hash === `#${path}`) {
    render();
    return;
  }
  location.hash = path;
}

function setBusy(busy) {
  view.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function showLoading() {
  view.replaceChildren(
    el('div', { class: 'skeleton' }),
    el('div', { class: 'skeleton' }),
    el('div', { class: 'skeleton' }),
  );
}

function showError(error) {
  const message = error instanceof ApiError ? error.message : '页面加载失败，请稍后重试。';
  view.replaceChildren(
    el('div', { class: 'state state--error' }, [
      el('p', { text: message, style: 'margin:0' }),
      el('button', { class: 'btn', type: 'button', text: '重试', onClick: () => render() }),
    ]),
  );
}

function markTabs(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    const key = tab.dataset.nav;
    const active = name === key || (name === 'day' && key === 'archive') || (name === 'today' && key === 'today');
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

async function load(path, params = {}) {
  if (path === 'index') return { days: await readIndex(Number(params.limit) || 60) };
  if (path === 'latest') return { day: await readLatest() };
  if (path === 'day') return { day: await readDay(params.date) };
  if (path === 'search') return readSearch(params.q, Number(params.days) || 30);
  throw new Error(`未知的数据请求：${path}`);
}

/* ---------- 当天视图 ---------- */

function itemCard(item, options = {}) {
  const meta = [];
  if (options.source) meta.push(el('span', { text: options.source }));
  if (item.publish_date) meta.push(el('span', { text: `${slashDate(item.publish_date)} 发布` }));
  if (item.status === 'updated') meta.push(el('span', { class: 'pill', text: '更新' }));
  if (item.body_state === 'login_required') {
    meta.push(el('span', { class: 'pill pill--warn', text: '正文需校内登录，仅标题' }));
  } else if (item.body_state === 'no_body') {
    meta.push(el('span', { class: 'pill pill--warn', text: '未取到正文' }));
  }

  const foot = [];
  if (item.deadline) foot.push(el('span', { class: 'pill pill--deadline', text: `截止 ${slashDate(item.deadline)}` }));
  for (const tag of item.tags) foot.push(el('span', { class: 'pill pill--tag', text: tag }));

  const attachments = item.attachments || [];
  const attachList = attachments.length
    ? el('ul', { class: 'attach' }, attachments.map((file, index) => el('li', {}, [
        el('span', { text: '附件：' }),
        el('a', {
          class: 'attach__name',
          href: file.url,
          target: '_blank',
          rel: 'noreferrer noopener',
          text: attachmentLabel(file.name, index),
        }),
      ])))
    : null;

  return el('article', { class: options.star ? 'card card--star' : 'card' }, [
    el('h3', { class: 'card__title' }, [
      el('a', { href: item.url, target: '_blank', rel: 'noreferrer noopener', text: item.title }),
    ]),
    meta.length ? el('div', { class: 'card__meta' }, meta) : null,
    item.summary ? el('p', { class: 'card__summary', text: item.summary }) : null,
    item.highlight_reason ? el('p', { class: 'card__reason', text: item.highlight_reason }) : null,
    foot.length ? el('div', { class: 'card__foot' }, foot) : null,
    attachList,
  ]);
}

function attachmentLabel(name, index) {
  const clean = String(name || '').split(/[\\/]/).pop() || '';
  const ext = (clean.match(/\.([a-z0-9]{1,5})$/i) || [])[1];
  if (!clean || /^[0-9a-f-]{16,}$/i.test(clean.replace(/\.[a-z0-9]+$/i, ''))) {
    return `附件 ${index + 1}${ext ? `（${ext.toUpperCase()}）` : ''}`;
  }
  return clean;
}

function highlightItems(day) {
  const items = [];
  for (const group of day.sources) {
    for (const item of group.items) {
      if (item.highlight) items.push({ ...item, source: group.name });
    }
  }
  return items.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999')
    || (b.publish_date || '').localeCompare(a.publish_date || ''));
}

function applyFilters(day, filters) {
  const needle = filters.q.trim().toLowerCase();
  const groups = [];
  let shown = 0;
  for (const group of day.sources) {
    const items = group.items.filter((item) => {
      if (filters.star && !item.highlight) return false;
      if (filters.source && group.name !== filters.source) return false;
      if (filters.tag && !item.tags.includes(filters.tag)) return false;
      if (needle) {
        const haystack = `${item.title} ${item.summary} ${item.tags.join(' ')}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
    if (items.length) {
      groups.push({ name: group.name, column: group.column, items });
      shown += items.length;
    }
  }
  const total = day.sources.reduce((sum, group) => sum + group.items.length, 0);
  return { groups, shown, total };
}

function filterPanel(day, onChange) {
  const sources = day.sources.map((group) => group.name);
  const tags = [...new Set(day.sources.flatMap((group) => group.items.flatMap((item) => item.tags)))];
  const filters = state.filters;

  const sourceChips = [el('button', {
    class: 'chip',
    type: 'button',
    'aria-pressed': filters.source === '' ? 'true' : 'false',
    text: '全部来源',
    onClick: () => { filters.source = ''; onChange(); },
  })].concat(sources.map((name) => {
    const count = day.sources.find((group) => group.name === name).items.length;
    return el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': filters.source === name ? 'true' : 'false',
      onClick: () => { filters.source = filters.source === name ? '' : name; onChange(); },
    }, [name, el('span', { class: 'chip__n', text: String(count) })]);
  }));

  const tagChips = tags.length
    ? [el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': filters.tag === '' ? 'true' : 'false',
        text: '全部标签',
        onClick: () => { filters.tag = ''; onChange(); },
      })].concat(tags.map((tag) => el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': filters.tag === tag ? 'true' : 'false',
        text: tag,
        onClick: () => { filters.tag = filters.tag === tag ? '' : tag; onChange(); },
      })))
    : null;

  const { shown, total } = applyFilters(day, filters);
  const active = filters.q || filters.source || filters.tag || filters.star;

  return el('div', { class: 'filters' }, [
    el('div', { class: 'filters__row' }, [
      el('input', {
        class: 'input',
        type: 'search',
        value: filters.q,
        placeholder: '在本期里找关键词',
        'aria-label': '在本期日报里搜索关键词',
        onInput: (event) => { filters.q = event.target.value; onChange('input'); },
      }),
      el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': filters.star ? 'true' : 'false',
        text: '只看重点',
        onClick: () => { filters.star = !filters.star; onChange(); },
      }),
    ]),
    el('div', { class: 'chips' }, sourceChips),
    tagChips ? el('div', { class: 'chips' }, tagChips) : null,
    el('div', { class: 'filters__foot' }, [
      el('span', { text: `显示 ${shown} / ${total} 条` }),
      active ? el('button', {
        class: 'linkbtn',
        type: 'button',
        text: '清除筛选',
        onClick: () => {
          state.filters = { q: '', source: '', tag: '', star: false };
          onChange();
        },
      }) : null,
    ]),
  ]);
}

function portalSection(day) {
  const portals = Array.isArray(day.portals) ? day.portals : [];
  if (!portals.length) return null;
  const counts = new Map((day.sources || []).map((group) => [group.name, group.items.length]));
  return el('section', { class: 'sect' }, [
    el('div', { class: 'sect__head' }, [
      el('h2', { class: 'sect__title', text: '来源入口' }),
      el('span', { class: 'sect__count', text: `${portals.length} 个来源` }),
      el('span', { class: 'sect__line' }),
    ]),
    el('div', { class: 'card' }, [
      el('ul', { class: 'portals' }, portals.map((entry) => {
        const count = counts.get(entry.name) || 0;
        return el('li', { class: 'portal' }, [
          el('a', { class: 'portal__link', href: entry.url, target: '_blank', rel: 'noreferrer noopener' }, [
            el('span', { class: 'portal__name', text: entry.name }),
            entry.column ? el('span', { class: 'portal__col', text: entry.column }) : null,
            entry.login ? el('span', { class: 'pill', text: '需登录' }) : null,
            el('span', {
              class: count ? 'portal__count' : 'portal__count portal__count--zero',
              text: count ? `${count} 条` : '无新增',
            }),
          ]),
        ]);
      })),
    ]),
  ]);
}

function dayView(day, routeName) {
  const { groups, shown, total } = applyFilters(day, state.filters);
  const highlights = highlightItems(day);
  const stats = day.stats || { new: 0, updated: 0, sources: 0 };
  const node = el('div', {});

  const statText = stats.new === 0 && stats.updated === 0
    ? '本期无新增'
    : `新增 ${stats.new} 条${stats.updated ? ` ｜ 更新 ${stats.updated} 条` : ''}`;
  const highlightCount = highlights.length;

  const pager = el('div', { class: 'pager' });
  if (routeName === 'day') {
    const days = state.days;
    let prev = null;
    let next = null;
    if (days) {
      const index = days.findIndex((entry) => entry.date === day.date);
      if (index >= 0) {
        prev = days[index + 1] || null;
        next = days[index - 1] || null;
      }
    }
    pager.append(
      el('button', {
        class: 'pager__btn',
        type: 'button',
        text: '← 更早',
        disabled: !prev,
        onClick: () => prev && setHash(`/day/${prev.date}`),
      }),
      el('button', {
        class: 'pager__btn',
        type: 'button',
        text: '更晚 →',
        disabled: !next,
        onClick: () => next && setHash(`/day/${next.date}`),
      }),
    );
  }
  pager.append(el('button', {
    class: 'pager__btn',
    type: 'button',
    text: '刷新',
    onClick: () => render(true),
  }));

  node.append(el('div', { class: 'dayhead' }, [
    el('div', { class: 'dayhead__row' }, [
      el('div', { class: 'dayhead__date' }, [
        slashDate(day.date),
        el('small', { text: weekday(day.date) }),
      ]),
      routeName === 'today' && day.date !== todayString()
        ? el('span', {
            class: 'dayhead__note',
            text: '今日尚未生成，以下是最近一期',
          })
        : null,
    ]),
    el('div', {
      class: 'dayhead__stat',
      text: [`${statText}`, highlightCount ? `重点 ${highlightCount} 条` : '', `覆盖 ${stats.sources} 个源`]
        .filter(Boolean)
        .join(' ｜ '),
    }),
    pager,
  ]));

  if (!total) {
    const empty = el('div', { class: 'state state--empty' }, [
      el('p', { class: 'state__title', text: day.date === todayString() ? '今日暂无新增' : '这一天没有新增' }),
      el('p', { text: '爬虫每天定时运行，有新的公开通知时会出现在这里。' }),
    ]);
    const latest = state.days?.find((entry) => entry.itemCount > 0 && entry.date !== day.date);
    if (latest) {
      empty.append(el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        text: `查看最近一期（${slashDate(latest.date)}，${latest.itemCount} 条）`,
        onClick: () => setHash(`/day/${latest.date}`),
      }));
    }
    node.append(empty);
    const portals = portalSection(day);
    if (portals) node.append(portals);
    return node;
  }

  if (highlights.length) {
    node.append(el('section', { class: 'sect sect--star' }, [
      el('div', { class: 'sect__head' }, [
        el('h2', { class: 'sect__title', text: '★ 重点关注' }),
        el('span', { class: 'sect__count', text: `${highlights.length} 条` }),
        el('span', { class: 'sect__line' }),
      ]),
      el('div', { class: 'card' }, [
        el('ul', { class: 'hl-list' }, highlights.map((item) => el('li', { class: 'hl' }, [
          el('a', {
            class: 'hl__title',
            href: item.url,
            target: '_blank',
            rel: 'noreferrer noopener',
            text: item.title,
          }),
          el('div', { class: 'hl__meta' }, [
            el('span', { text: item.source }),
            item.deadline
              ? el('span', { class: 'pill pill--deadline', text: `截止 ${slashDate(item.deadline)}` })
              : null,
            item.highlight_reason ? el('span', { text: item.highlight_reason }) : null,
          ]),
        ]))),
      ]),
    ]));
  }

  node.append(el('section', { class: 'sect' }, [
    el('div', { class: 'sect__head' }, [
      el('h2', { class: 'sect__title', text: '全部条目' }),
      el('span', { class: 'sect__line' }),
    ]),
    filterPanel(day, (reason) => renderDayBody(reason)),
  ]));

  if (!shown) {
    node.append(el('p', { class: 'state', text: '没有符合筛选条件的条目，试试清除筛选。' }));
  }
  for (const group of groups) {
    node.append(el('section', { class: 'sect' }, [
      el('div', { class: 'sect__head' }, [
        el('h2', { class: 'sect__title', text: group.name }),
        group.column ? el('span', { class: 'sect__count', text: group.column }) : null,
        el('span', { class: 'sect__count', text: `${group.items.length} 条` }),
        el('span', { class: 'sect__line' }),
      ]),
      ...group.items.map((item) => itemCard(item)),
    ]));
  }

  const portals = portalSection(day);
  if (portals) node.append(portals);

  if (day.errors?.length) {
    node.append(el('section', { class: 'sect' }, [
      el('div', { class: 'sect__head' }, [
        el('h2', { class: 'sect__title', text: '抓取异常' }),
        el('span', { class: 'sect__line' }),
      ]),
      ...day.errors.map((entry) => el('p', { class: 'state', text: `${entry.source}：${entry.reason}` })),
    ]));
  }

  return node;
}

function renderDayBody() {
  if (!state.day) return;
  const scroll = window.scrollY;
  const route = parseHash();
  view.replaceChildren(dayView(state.day, route.name));
  window.scrollTo(0, scroll);
}

/* ---------- 归档 / 搜索 ---------- */

function archiveView(days) {
  const node = el('div', {});
  node.append(el('div', { class: 'dayhead' }, [
    el('div', { class: 'dayhead__row' }, [el('div', { class: 'dayhead__date', text: '归档' })]),
    el('div', { class: 'dayhead__stat', text: `共 ${days.length} 期（最多保留 60 期）` }),
  ]));
  if (!days.length) {
    node.append(el('div', { class: 'state state--empty' }, [
      el('p', { class: 'state__title', text: '还没有归档' }),
      el('p', { text: '日报每天自动生成，往期会按日期列在这里。' }),
    ]));
    return node;
  }
  for (const entry of days) {
    const label = entry.itemCount
      ? `新增 ${entry.newCount}${entry.updatedCount ? ` ｜ 更新 ${entry.updatedCount}` : ''}${entry.highlightCount ? ` ｜ 重点 ${entry.highlightCount}` : ''}`
      : '无新增';
    node.append(el('button', {
      class: 'dayrow',
      type: 'button',
      'aria-label': `${entry.date} ${label}`,
      onClick: () => setHash(`/day/${entry.date}`),
    }, [
      el('span', {}, [
        el('span', { class: 'dayrow__date', text: monthDay(entry.date) }),
        el('span', { class: 'dayrow__week', text: ` ${weekday(entry.date)}` }),
      ]),
      el('span', { class: 'dayrow__stat', text: label }),
    ]));
  }
  return node;
}

function searchView(query, items, scannedDays) {
  const node = el('div', {});
  const input = el('input', {
    class: 'input',
    type: 'search',
    value: query,
    placeholder: '搜索历史通知，如：交换、奖学金',
    'aria-label': '搜索全部日报',
  });
  const submit = () => {
    const value = input.value.trim();
    if (value.length < 2) {
      input.focus();
      return;
    }
    setHash(`/search?q=${encodeURIComponent(value)}`);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  node.append(el('div', { class: 'dayhead' }, [
    el('div', { class: 'dayhead__row' }, [el('div', { class: 'dayhead__date', text: '搜索' })]),
    el('div', { class: 'dayhead__stat', text: '在最近 30 期日报里查找标题、摘要和标签' }),
  ]));
  node.append(el('div', { class: 'filters' }, [
    el('div', { class: 'filters__row' }, [
      input,
      el('button', { class: 'chip', type: 'button', text: '搜索', onClick: submit }),
    ]),
  ]));

  if (!query) {
    node.append(el('p', { class: 'state', text: '输入至少 2 个字开始搜索，例如「交换」「讲座」「报名」。' }));
    return node;
  }
  if (!items || !items.length) {
    node.append(el('div', { class: 'state state--empty' }, [
      el('p', { class: 'state__title', text: `没有找到「${query}」` }),
      el('p', { text: `已检索最近 ${scannedDays} 期日报。换个词试试。` }),
    ]));
    return node;
  }

  const byDate = new Map();
  for (const item of items) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push(item);
  }
  node.append(el('p', { class: 'state', text: `命中 ${items.length} 条，来自最近 ${scannedDays} 期` }));
  for (const [date, group] of byDate) {
    node.append(el('section', { class: 'sect' }, [
      el('div', { class: 'sect__head' }, [
        el('h2', { class: 'sect__title', text: `${slashDate(date)} ${weekday(date)}` }),
        el('span', { class: 'sect__count', text: `${group.length} 条` }),
        el('span', { class: 'sect__line' }),
      ]),
      ...group.map((item) => itemCard(item, { source: item.source })),
    ]));
  }
  return node;
}

/* ---------- 本周 ---------- */

function addDays(value, count) {
  const date = parseDate(value);
  date.setDate(date.getDate() + count);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const daysLeft = (deadline) =>
  Math.round((parseDate(deadline) - parseDate(todayString())) / 86400000);

function deadlineLabel(deadline) {
  const left = daysLeft(deadline);
  if (left <= 0) return '今天截止';
  if (left === 1) return '明天截止';
  return `剩 ${left} 天`;
}

function upcomingItems(items, days = 14, limit = 20) {
  const today = todayString();
  const end = addDays(today, days);
  return items
    .filter((item) => item.deadline && item.deadline >= today && item.deadline <= end)
    .sort((a, b) => a.deadline.localeCompare(b.deadline)
      || (b.publish_date || '').localeCompare(a.publish_date || ''))
    .slice(0, limit);
}

function reviewSection(week) {
  const head = el('div', { class: 'sect__head' }, [
    el('h2', { class: 'sect__title', text: '周报综述' }),
    el('span', { class: 'sect__line' }),
  ]);
  if (!week) {
    return el('section', { class: 'sect' }, [
      head,
      el('div', { class: 'card' }, [
        el('p', { class: 'weekcard__text weekcard__text--muted', text: '周报每周一自动生成，生成后会在这里给出上周通知的综述。' }),
      ]),
    ]);
  }

  const stats = week.stats || {};
  const card = el('div', { class: 'card' }, [
    el('div', { class: 'weekcard__head' }, [
      el('span', { class: 'weekcard__range', text: `${slashDate(week.weekStart)} ~ ${slashDate(week.weekEnd)}` }),
      el('span', { class: 'weekcard__gen', text: week.generatedAt ? `${slashDate(week.generatedAt.slice(0, 10))} 生成` : '' }),
    ]),
    week.overview
      ? el('p', { class: 'weekcard__text', text: week.overview })
      : el('p', { class: 'weekcard__text weekcard__text--muted', text: '这一期综述未生成，下面的统计仍然可用。' }),
    el('div', { class: 'weekcard__stats', text: `新增 ${stats.items || 0} 条 ｜ 重点 ${stats.highlight || 0} 条 ｜ 覆盖 ${stats.sources || 0} 个源 ｜ ${stats.days || 0} 天有更新` }),
  ]);
  const foot = [
    ...(week.hotSources || []).map((entry) => el('span', { class: 'pill', text: `${entry.name} ${entry.count}` })),
    ...(week.topTags || []).map((entry) => el('span', { class: 'pill pill--tag', text: `${entry.tag} ${entry.count}` })),
  ];
  if (foot.length) card.append(el('div', { class: 'card__foot' }, foot));
  return el('section', { class: 'sect' }, [head, card]);
}

function weekStripSection(recent) {
  if (!recent.length) return null;
  const cells = recent.slice().reverse().map((entry) => el('button', {
    class: entry.itemCount ? 'weekgrid__cell' : 'weekgrid__cell weekgrid__cell--zero',
    type: 'button',
    'aria-label': `${entry.date} ${entry.itemCount ? `新增 ${entry.itemCount} 条` : '无新增'}`,
    onClick: () => setHash(`/day/${entry.date}`),
  }, [
    el('span', { class: 'weekgrid__day', text: String(Number(entry.date.slice(8, 10))) }),
    el('span', { class: 'weekgrid__week', text: weekday(entry.date).slice(1) }),
    el('span', { class: 'weekgrid__n', text: entry.itemCount ? String(entry.itemCount) : '—' }),
    entry.highlightCount ? el('span', { class: 'weekgrid__star', text: `★ ${entry.highlightCount}` }) : null,
  ]));
  return el('section', { class: 'sect' }, [
    el('div', { class: 'sect__head' }, [
      el('h2', { class: 'sect__title', text: '近 7 天' }),
      el('span', { class: 'sect__line' }),
    ]),
    el('div', { class: 'card' }, [el('div', { class: 'weekgrid' }, cells)]),
  ]);
}

function upcomingSection(items) {
  const list = upcomingItems(items);
  if (!list.length) return null;
  return el('section', { class: 'sect' }, [
    el('div', { class: 'sect__head' }, [
      el('h2', { class: 'sect__title', text: '⏰ 即将截止' }),
      el('span', { class: 'sect__count', text: `未来 14 天 · ${list.length} 条` }),
      el('span', { class: 'sect__line' }),
    ]),
    el('div', { class: 'card' }, [
      el('ul', { class: 'hl-list' }, list.map((item) => el('li', { class: 'hl' }, [
        el('a', { class: 'hl__title', href: item.url, target: '_blank', rel: 'noreferrer noopener', text: item.title }),
        el('div', { class: 'hl__meta' }, [
          el('span', { text: item.source }),
          el('span', { class: 'pill pill--deadline', text: `${slashDate(item.deadline)} 截止` }),
          el('span', {
            class: daysLeft(item.deadline) <= 3 ? 'pill pill--urgent' : 'pill',
            text: deadlineLabel(item.deadline),
          }),
        ]),
      ]))),
    ]),
  ]);
}

function weekHighlightSection(items) {
  const list = items
    .filter((item) => item.highlight)
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999')
      || (b.date || '').localeCompare(a.date || ''))
    .slice(0, 20);
  if (!list.length) return null;
  return el('section', { class: 'sect sect--star' }, [
    el('div', { class: 'sect__head' }, [
      el('h2', { class: 'sect__title', text: '★ 本周重点' }),
      el('span', { class: 'sect__count', text: `${list.length} 条` }),
      el('span', { class: 'sect__line' }),
    ]),
    el('div', { class: 'card' }, [
      el('ul', { class: 'hl-list' }, list.map((item) => el('li', { class: 'hl' }, [
        el('a', { class: 'hl__title', href: item.url, target: '_blank', rel: 'noreferrer noopener', text: item.title }),
        el('div', { class: 'hl__meta' }, [
          el('span', { text: item.source }),
          el('span', { text: slashDate(item.date) }),
          item.deadline
            ? el('span', { class: 'pill pill--deadline', text: `截止 ${slashDate(item.deadline)}` })
            : null,
          item.highlight_reason ? el('span', { text: item.highlight_reason }) : null,
        ]),
      ]))),
    ]),
  ]);
}

function sourceDistSection(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.source, (counts.get(item.source) || 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
  if (!rows.length) return null;
  const max = rows[0][1];
  return el('section', { class: 'sect' }, [
    el('div', { class: 'sect__head' }, [
      el('h2', { class: 'sect__title', text: '来源分布' }),
      el('span', { class: 'sect__line' }),
    ]),
    el('div', { class: 'card' }, [
      el('ul', { class: 'dist' }, rows.map(([name, count]) => el('li', { class: 'dist__row' }, [
        el('span', { class: 'dist__name', text: name }),
        el('span', { class: 'dist__track' }, [
          el('span', { class: 'dist__fill', style: `width:${Math.round((count / max) * 100)}%` }),
        ]),
        el('span', { class: 'dist__n', text: String(count) }),
      ]))),
    ]),
  ]);
}

function weekView(week, items, days) {
  const recent = days.slice(0, 7);
  const window = new Set(recent.map((entry) => entry.date));
  const recentItems = items.filter((item) => window.has(item.date));
  const newCount = recent.reduce((sum, entry) => sum + (entry.itemCount || 0), 0);
  const highlightCount = recent.reduce((sum, entry) => sum + (entry.highlightCount || 0), 0);
  const sourceCount = new Set(recentItems.map((item) => item.source)).size;
  const range = recent.length
    ? `${slashDate(recent[recent.length - 1].date)} ~ ${slashDate(recent[0].date)}`
    : '';

  const node = el('div', {});
  node.append(el('div', { class: 'dayhead' }, [
    el('div', { class: 'dayhead__row' }, [
      el('div', { class: 'dayhead__date' }, ['本周', range ? el('small', { text: range }) : null]),
    ]),
    el('div', {
      class: 'dayhead__stat',
      text: `近 7 天 ｜ 新增 ${newCount} 条 ｜ 重点 ${highlightCount} 条 ｜ 覆盖 ${sourceCount} 个源`,
    }),
    el('div', { class: 'pager' }, [
      el('button', { class: 'pager__btn', type: 'button', text: '刷新', onClick: () => render(true) }),
    ]),
  ]));

  if (!recentItems.length) {
    node.append(el('div', { class: 'state state--empty' }, [
      el('p', { class: 'state__title', text: '最近 7 天没有新增' }),
      el('p', { text: '爬虫每天定时运行，有新的公开通知时会出现在这里。' }),
    ]));
    node.append(reviewSection(week));
    return node;
  }

  node.append(reviewSection(week));
  node.append(weekStripSection(recent));
  const upcoming = upcomingSection(items);
  if (upcoming) node.append(upcoming);
  const star = weekHighlightSection(recentItems);
  if (star) node.append(star);
  node.append(sourceDistSection(recentItems));
  return node;
}

/* ---------- 渲染入口 ---------- */

async function render(force = false) {
  const route = parseHash();
  markTabs(route.name);
  setBusy(true);

  const token = ++state.token;

  try {
    if (route.name === 'archive') {
      if (!state.days || force) {
        showLoading();
        const days = await load('index', { limit: '60' });
        if (token !== state.token) return;
        state.days = Array.isArray(days.days) ? days.days : [];
      }
      document.title = '归档 · 南大信息日报';
      view.replaceChildren(archiveView(state.days));
      return;
    }

    if (route.name === 'week') {
      document.title = '本周 · 南大信息日报';
      if (!state.week.items || !state.week.data || force || !state.days) {
        showLoading();
        const daysPromise = state.days && !force ? Promise.resolve(null) : load('index', { limit: '60' });
        const [daysResult, windowItems, week] = await Promise.all([
          daysPromise,
          readWindow(60, 400),
          readWeek(),
        ]);
        if (token !== state.token) return;
        if (daysResult) state.days = Array.isArray(daysResult.days) ? daysResult.days : [];
        state.week = { data: week, items: windowItems };
      }
      view.replaceChildren(weekView(state.week.data, state.week.items, state.days || []));
      return;
    }

    if (route.name === 'search') {
      document.title = '搜索 · 南大信息日报';
      if (!route.q) {
        state.search = { q: '', items: null, scannedDays: 0 };
        view.replaceChildren(searchView('', null, 0));
        return;
      }
      if (state.search.q !== route.q || force) {
        showLoading();
        const result = await load('search', { q: route.q, days: '30' });
        if (token !== state.token) return;
        state.search = { q: route.q, items: result.items || [], scannedDays: result.scannedDays || 0 };
      }
      view.replaceChildren(searchView(route.q, state.search.items, state.search.scannedDays));
      return;
    }

    const wantDate = route.name === 'day' ? route.date : 'latest';
    const needDay = force || !state.day || state.daySource !== wantDate;
    if (needDay || !state.days) {
      showLoading();
      const daysPromise = state.days && !force ? Promise.resolve(null) : load('index', { limit: '60' });
      const dayPromise = wantDate === 'latest' ? load('latest') : load('day', { date: wantDate });
      const [daysResult, dayResult] = await Promise.all([daysPromise, dayPromise]);
      if (token !== state.token) return;
      if (daysResult) state.days = Array.isArray(daysResult.days) ? daysResult.days : [];
      state.day = dayResult.day;
      state.daySource = wantDate;
      state.filters = { q: '', source: '', tag: '', star: false };
    }
    document.title = `${slashDate(state.day.date)} · 南大信息日报`;
    view.replaceChildren(dayView(state.day, route.name));
  } catch (error) {
    if (token !== state.token) return;
    if (error instanceof ApiError && error.code === 'no_digest') {
      view.replaceChildren(el('div', { class: 'state state--empty' }, [
        el('p', { class: 'state__title', text: '这一期还没有日报' }),
        el('p', { text: '日报每天自动生成，可以到归档里看其他日期。' }),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          text: '查看归档',
          onClick: () => setHash('/archive'),
        }),
      ]));
      return;
    }
    showError(error);
  } finally {
    if (token === state.token) setBusy(false);
  }
}

window.addEventListener('hashchange', () => render());
render();
