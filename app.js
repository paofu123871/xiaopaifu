let currentModule = null;
let checkinData = {};

// ===== 数据持久化（本地 + GitHub Gist 云同步） =====
const GIST_ID = 'YOUR_GIST_ID';        // 首次运行自动创建
const GIST_FILENAME = 'xiaopaifu_data.json';
let GIST_TOKEN = '';                    // 从 localStorage 读取
let _syncTimer = null;
let _lastCloudHash = '';

// 初始化：加载 token，加载本地数据，尝试从云端同步
function loadData() {
  GIST_TOKEN = localStorage.getItem('xiaopaifu_token') || '';
  // 先从本地加载
  try {
    const saved = localStorage.getItem('xiaopaifu_data');
    if (saved) checkinData = JSON.parse(saved);
  } catch (e) { checkinData = {}; }
  // 尝试从云端同步
  if (GIST_TOKEN) syncFromCloud();
}

function saveData() {
  localStorage.setItem('xiaopaifu_data', JSON.stringify(checkinData));
  // 自动同步到云端（防抖 2 秒）
  if (GIST_TOKEN) {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(syncToCloud, 2000);
  }
}

// 从 Gist 拉取数据
async function syncFromCloud() {
  if (!GIST_TOKEN) return;
  try {
    // 先获取 gist 列表，找我们的 gist
    const gistId = localStorage.getItem('xiaopaifu_gist_id');
    if (!gistId) { await findOrCreateGist(); return; }
    
    const resp = await fetch('https://api.github.com/gists/' + gistId, {
      headers: { 'Authorization': 'token ' + GIST_TOKEN }
    });
    if (!resp.ok) { console.log('Gist fetch failed:', resp.status); return; }
    
    const gist = await resp.json();
    const file = gist.files && gist.files[GIST_FILENAME];
    if (!file || !file.content) return;
    
    const cloudData = JSON.parse(file.content);
    const cloudHash = JSON.stringify(cloudData);
    
    // 如果云端数据比本地新，用云端的
    if (cloudHash !== _lastCloudHash) {
      _lastCloudHash = cloudHash;
      // 合并策略：取日期最多的
      const merged = mergeData(checkinData, cloudData);
      checkinData = merged;
      localStorage.setItem('xiaopaifu_data', JSON.stringify(checkinData));
      renderNav(); renderMain();
    }
  } catch(e) { console.log('Sync from cloud error:', e); }
}

// 上传数据到 Gist
async function syncToCloud() {
  if (!GIST_TOKEN) return;
  try {
    const gistId = localStorage.getItem('xiaopaifu_gist_id');
    if (!gistId) { await findOrCreateGist(); return; }
    
    const dataStr = JSON.stringify(checkinData);
    if (dataStr === _lastCloudHash) return; // 没变化，不同步
    
    const body = {
      files: { [GIST_FILENAME]: { content: dataStr } }
    };
    
    const resp = await fetch('https://api.github.com/gists/' + gistId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'token ' + GIST_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    if (resp.ok) {
      _lastCloudHash = dataStr;
      console.log('Synced to cloud OK');
    } else {
      console.log('Sync failed:', resp.status);
    }
  } catch(e) { console.log('Sync to cloud error:', e); }
}

// 查找或创建 Gist
async function findOrCreateGist() {
  if (!GIST_TOKEN) return;
  try {
    // 先查找已有 gist
    const resp = await fetch('https://api.github.com/gists?per_page=100', {
      headers: { 'Authorization': 'token ' + GIST_TOKEN }
    });
    if (!resp.ok) return;
    const gists = await resp.json();
    const existing = gists.find(g => g.files && g.files[GIST_FILENAME]);
    
    if (existing) {
      localStorage.setItem('xiaopaifu_gist_id', existing.id);
      await syncFromCloud();
      return;
    }
    
    // 创建新 gist
    const createResp = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        'Authorization': 'token ' + GIST_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: '小泡芙打卡数据',
        public: false,
        files: { [GIST_FILENAME]: { content: JSON.stringify(checkinData) } }
      })
    });
    
    if (createResp.ok) {
      const gist = await createResp.json();
      localStorage.setItem('xiaopaifu_gist_id', gist.id);
      _lastCloudHash = JSON.stringify(checkinData);
      console.log('Gist created:', gist.id);
    }
  } catch(e) { console.log('Find/create gist error:', e); }
}

// 合并两个数据源（保留所有日期的打卡记录）
function mergeData(local, cloud) {
  const merged = {};
  // 先合并云端的
  for (const date in cloud) merged[date] = cloud[date];
  // 再合并本地的（本地优先）
  for (const date in local) {
    if (!merged[date]) {
      merged[date] = local[date];
    } else {
      // 同一日期，保留打卡项更多的
      const cloudKeys = Object.keys(merged[date]);
      const localKeys = Object.keys(local[date]);
      if (localKeys.length > cloudKeys.length) {
        merged[date] = local[date];
      } else {
        // 合并同一日期的不同模块打卡
        for (const k of localKeys) {
          if (!merged[date][k]) merged[date][k] = local[date][k];
        }
      }
    }
  }
  return merged;
}

// 设置 Token（用户手动输入）
function setSyncToken(token) {
  if (!token || token.length < 10) return false;
  GIST_TOKEN = token;
  localStorage.setItem('xiaopaifu_token', token);
  findOrCreateGist();
  return true;
}

// 手动触发同步
async function manualSync() {
  await syncFromCloud();
  await syncToCloud();
  renderNav(); renderMain();
  alert('同步完成！');
}

// 清除同步设置
function clearSync() {
  localStorage.removeItem('xiaopaifu_token');
  localStorage.removeItem('xiaopaifu_gist_id');
  GIST_TOKEN = '';
  alert('已清除同步设置');
}

// ===== 语音播放（真人MP3） =====
// 加载音频映射表
let AUDIO_MAP = {};
(async function() {
  try {
    const resp = await fetch('audio/map.json');
    AUDIO_MAP = await resp.json();
  } catch(e) { console.log('Audio map not loaded, fallback to TTS'); }
})();

let _currentAudio = null;

function speak(text) {
  // 优先使用预生成真人MP3
  if (AUDIO_MAP && AUDIO_MAP[text]) {
    _playMp3(AUDIO_MAP[text], 1.0);
    return;
  }
  // 回退到浏览器合成
  _speakTTS(text, 0.85);
}

function speakSlow(text) {
  // 优先使用预生成真人MP3（慢速）
  if (AUDIO_MAP && AUDIO_MAP[text]) {
    _playMp3(AUDIO_MAP[text], 0.75);
    return;
  }
  _speakTTS(text, 0.6);
}

function _playMp3(src, rate) {
  if (_currentAudio) { _currentAudio.pause(); _currentAudio = null; }
  const audio = new Audio(src);
  audio.playbackRate = rate;
  audio.play().catch(() => {
    // 如果MP3加载失败，回退TTS
    console.log('MP3 load failed, using TTS fallback');
  });
  _currentAudio = audio;
}

function _speakTTS(text, rate) {
  if (!('speechSynthesis' in window)) { return; }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = rate;
  window.speechSynthesis.speak(utter);
}

// ===== 导航 =====
function renderNav() {
  const sidebar = document.getElementById('sidebar');
  const today = getTodayStr();
  const todayData = checkinData[today] || {};
  let html = '<div class="sidebar-logo">🧁</div>';
  html += `<div class="nav-item ${!currentModule ? 'active' : ''}" onclick="switchModule(null)"><span class="nav-icon">🏠</span><span class="nav-label">首页</span></div>`;
  Object.values(MODULES_DATA).forEach(mod => {
    const checked = todayData[mod.id];
    html += `<div class="nav-item ${currentModule === mod.id ? 'active' : ''}" onclick="switchModule('${mod.id}')"><span class="nav-icon">${mod.icon}</span><span class="nav-label">${mod.name}</span>${checked ? '<span class="nav-badge done"></span>' : ''}</div>`;
  });
  html += '<div class="sidebar-sync-btn" onclick="toggleSyncSettings()" title="云同步设置">☁️</div>';
  sidebar.innerHTML = html;
}

function switchModule(modId) {
  currentModule = modId;
  renderNav();
  renderMain();
  window.scrollTo(0, 0);
}

function renderMain() {
  const main = document.getElementById('main');
  if (!currentModule) {
    main.innerHTML = renderHome();
  } else {
    main.innerHTML = renderModule(MODULES_DATA[currentModule]);
  }
}

// ===== 首页 =====
function renderHome() {
  if (GIST_TOKEN) { setTimeout(() => { const el = document.getElementById('sync-indicator'); if (el) el.style.display = 'block'; }, 100); }
  const todayStr = getTodayStr();
  const todayData = checkinData[todayStr] || {};
  const todayCount = Object.keys(todayData).length;
  const totalCount = Object.keys(MODULES_DATA).length;
  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${['日','一','二','三','四','五','六'][now.getDay()]}`;
  let totalDays = 0;
  Object.values(checkinData).forEach(day => { if (Object.keys(day).length > 0) totalDays++; });
  let totalStreak = 0;
  Object.keys(MODULES_DATA).forEach(id => { totalStreak += getStreakCount(checkinData, id); });

  return `
    <div class="welcome-card">
      <div class="welcome-title">🧁 小泡芙 · 自我提升工作台</div>
      <div class="welcome-sub">每天进步一点点，成为更好的自己</div>
      <div class="welcome-date">${dateStr} · 今日打卡 ${todayCount}/${totalCount}</div>
    </div>
    <div id="sync-indicator" style="display:none;text-align:center;margin-bottom:8px;font-size:11px;color:var(--pink-500);">
      ☁️ 已开启云同步 · 数据自动备份
    </div>
    <div class="stats-row">
      <div class="stat-box"><div class="stat-num">${todayCount}/${totalCount}</div><div class="stat-label">今日打卡</div></div>
      <div class="stat-box"><div class="stat-num">${totalDays}</div><div class="stat-label">累计天数</div></div>
      <div class="stat-box"><div class="stat-num">${totalStreak}</div><div class="stat-label">连续🔥总数</div></div>
    </div>
    <div class="heatmap-card">
      <div class="heatmap-title">📅 近90天打卡热力图</div>
      <div class="overall-heatmap">${getOverallHeatmap()}</div>
      <div class="heatmap-legend">
        <span>少</span>
        <div class="cell" style="background:#F0F0F0"></div>
        <div class="cell" style="background:#FFC9DA"></div>
        <div class="cell" style="background:#FFA8C5"></div>
        <div class="cell" style="background:#FF85B0"></div>
        <div class="cell" style="background:#FF6B9D"></div>
        <span>多</span>
      </div>
    </div>
    <div class="content-card">
      <div class="card-title"><span class="emoji">📋</span> 今日任务清单</div>
      ${renderTodayTasks(todayData)}
    </div>
    ${(() => { const quote = getDailyQuote(); window._todayQuote = quote; return ''; })()}
    <div class="quote-card">
      <div class="quote-type">📜 每日好句</div>
      <div class="quote-text">${getDailyQuote().text}</div>
      <div class="quote-author">—— ${getDailyQuote().author}</div>
      ${getDailyQuote().note ? `<div class="quote-note">💡 ${getDailyQuote().note}</div>` : ''}
    </div>
    <div class="tips-card">
      <div class="card-title"><span class="emoji">💪</span> 小泡芙寄语</div>
      <div class="tip-item">⭐ 每天打开就能直接学，不用跳转</div>
      <div class="tip-item">📱 添加到手机桌面，打开就像App一样</div>
      <div class="tip-item">🔥 保持连续打卡，不要让火苗熄灭</div>
    </div>
  `;
}

function renderTodayTasks(todayData) {
  let html = '';
  Object.values(MODULES_DATA).forEach(mod => {
    const checked = todayData[mod.id];
    html += `<div onclick="switchModule('${mod.id}')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--pink-50);cursor:pointer;">
      <div style="display:flex;align-items:center;gap:8px;"><span style="font-size:20px;">${mod.icon}</span><div><div style="font-size:14px;font-weight:600;color:var(--text-main);">${mod.name}</div><div style="font-size:11px;color:var(--text-light);">${mod.duration}</div></div></div>
      <div>${checked ? '<span style="font-size:20px;">✅</span>' : '<span style="font-size:20px;opacity:0.3;">⬜</span>'}</div>
    </div>`;
  });
  return html;
}

function getOverallHeatmap() {
  const today = new Date();
  let html = '';
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const dateStr = formatDate(d);
    const count = checkinData[dateStr] ? Object.keys(checkinData[dateStr]).length : 0;
    let cls = '';
    if (count >= 1 && count < 3) cls = 'l1';
    else if (count >= 3 && count < 5) cls = 'l2';
    else if (count >= 5) cls = 'l4';
    html += `<div class="overall-cell ${cls}" title="${dateStr} · ${count}项"></div>`;
  }
  return html;
}

// ===== 通用打卡卡片 =====
function renderCheckinCard(mod) {
  const streak = getStreakCount(checkinData, mod.id);
  const total = getTotalCount(checkinData, mod.id);
  if (GIST_TOKEN) { setTimeout(() => { const el = document.getElementById('sync-indicator'); if (el) el.style.display = 'block'; }, 100); }
  const todayStr = getTodayStr();
  const todayRecord = (checkinData[todayStr] && checkinData[todayStr][mod.id]) || null;
  const isDone = !!todayRecord;
  return `
    <div class="checkin-card">
      <div class="checkin-header">
        <div><div class="checkin-title">每日打卡</div><div style="font-size:12px;color:var(--text-light);margin-top:2px;">累计 ${total} 天</div></div>
        ${streak > 0 ? `<div class="streak-badge">🔥 ${streak}天连续</div>` : ''}
      </div>
      <button class="checkin-btn ${isDone ? 'checked' : ''}" onclick="toggleCheckin('${mod.id}')">${isDone ? '✅ 今日已打卡' : '📝 点击打卡'}</button>
      <div class="checkin-input-area ${isDone ? 'show' : ''}" id="input-${mod.id}">
        <div class="input-row"><input class="input-field" type="number" id="duration-${mod.id}" placeholder="练习时长（分钟）" value="${todayRecord && todayRecord.duration ? todayRecord.duration : ''}" min="0"></div>
        <textarea class="input-field" id="note-${mod.id}" placeholder="今天的心得体会、收获、感受..." rows="3">${todayRecord && todayRecord.note ? todayRecord.note : ''}</textarea>
        <button class="save-btn" onclick="saveNote('${mod.id}')" style="margin-top:8px;width:100%;">💾 保存记录</button>
      </div>
    </div>
    <div id="sync-indicator" style="display:none;text-align:center;margin-bottom:8px;font-size:11px;color:var(--pink-500);">
      ☁️ 已开启云同步 · 数据自动备份
    </div>
    <div class="stats-row">
      <div class="stat-box"><div class="stat-num">${streak}</div><div class="stat-label">连续天数</div></div>
      <div class="stat-box"><div class="stat-num">${total}</div><div class="stat-label">累计打卡</div></div>
      <div class="stat-box"><div class="stat-num">${getThisWeekCount(mod.id)}</div><div class="stat-label">本周打卡</div></div>
    </div>
    <div class="heatmap-card">
      <div class="heatmap-title">📅 近90天打卡记录</div>
      <div class="heatmap-grid">${getModuleHeatmap(mod.id)}</div>
    </div>
  `;
}

function getModuleHeatmap(modId) {
  const today = new Date();
  let html = '';
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const dateStr = formatDate(d);
    const checked = checkinData[dateStr] && checkinData[dateStr][modId];
    let cls = '';
    if (checked) {
      const dur = checked.duration || 0;
      if (dur >= 30) cls = 'l4'; else if (dur >= 15) cls = 'l3'; else cls = 'l2';
    }
    html += `<div class="heatmap-cell ${cls}" title="${dateStr}"></div>`;
  }
  return html;
}

function getThisWeekCount(modId) {
  const today = new Date();
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const dateStr = formatDate(d);
    if (checkinData[dateStr] && checkinData[dateStr][modId]) count++;
  }
  return count;
}

function renderHistory(modId) {
  const notes = [];
  const dates = Object.keys(checkinData).sort().reverse();
  for (const date of dates) {
    const day = checkinData[date];
    if (day[modId]) {
      notes.push({ date, note: day[modId].note, duration: day[modId].duration });
      if (notes.length >= 10) break;
    }
  }
  if (notes.length === 0) return '';
  return `<div class="content-card">
    <div class="card-title"><span class="emoji">📖</span> 打卡历史</div>
    ${notes.map(n => `<div class="note-item">
      <div class="note-date">${n.date}</div>
      ${n.duration ? `<span class="note-duration">⏱ ${n.duration}分钟</span>` : ''}
      ${n.note ? `<div class="note-text" style="margin-top:4px;">${n.note}</div>` : '<div class="note-text" style="color:var(--text-light);">已打卡</div>'}
    </div>`).join('')}
  </div>`;
}

function toggleCheckin(modId) {
  if (GIST_TOKEN) { setTimeout(() => { const el = document.getElementById('sync-indicator'); if (el) el.style.display = 'block'; }, 100); }
  const todayStr = getTodayStr();
  if (!checkinData[todayStr]) checkinData[todayStr] = {};
  if (checkinData[todayStr][modId]) {
    delete checkinData[todayStr][modId];
    if (Object.keys(checkinData[todayStr]).length === 0) delete checkinData[todayStr];
  } else {
    checkinData[todayStr][modId] = { note: '', duration: null, time: new Date().toISOString() };
  }
  saveData(); renderNav(); renderMain();
}

function saveNote(modId) {
  if (GIST_TOKEN) { setTimeout(() => { const el = document.getElementById('sync-indicator'); if (el) el.style.display = 'block'; }, 100); }
  const todayStr = getTodayStr();
  if (!checkinData[todayStr]) checkinData[todayStr] = {};
  if (!checkinData[todayStr][modId]) checkinData[todayStr][modId] = {};
  const durationEl = document.getElementById(`duration-${modId}`);
  const noteEl = document.getElementById(`note-${modId}`);
  checkinData[todayStr][modId] = {
    note: noteEl ? noteEl.value : '',
    duration: durationEl && durationEl.value ? parseInt(durationEl.value) : null,
    time: new Date().toISOString()
  };
  saveData(); renderNav(); renderMain();
}

// ===== 模块详情 =====
function renderModule(mod) {
  let html = `<div class="page-header"><div class="page-title">${mod.icon} ${mod.name}</div><div class="page-subtitle">${mod.subtitle} · 每天${mod.duration}</div></div>`;
  html += renderCheckinCard(mod);
  if (mod.goal) {
    html += `<div class="content-card"><div class="card-title"><span class="emoji">🎯</span> 目标</div><div style="font-size:13px;color:var(--text-sub);line-height:1.8;">${mod.goal}</div></div>`;
  }
  html += renderModuleContent(mod);
  html += renderHistory(mod.id);
  return html;
}

function renderModuleContent(mod) {
  switch (mod.id) {
    case 'english': return renderEnglish(mod);
    case 'news': return renderNews(mod);
    case 'knowledge': return renderKnowledge(mod);
    case 'fitness': return renderFitness(mod);
    case 'speech': return renderSpeech(mod);
    case 'ukulele': return renderUkulele(mod);
    default: return '';
  }
}

// ===== 英语 =====
function renderEnglish(mod) {
  const t = mod.today;
  const v = t.video;
  let html = '';

  // Theme banner
  html += `<div class="content-card" style="background:linear-gradient(135deg,#FF6B9D,#FF8FA3);color:#fff;">
    <div style="font-size:18px;font-weight:800;margin-bottom:4px;">${t.theme}</div>
    <div style="font-size:13px;opacity:0.9;">${t.themeDesc}</div>
    <div style="display:inline-block;margin-top:8px;background:rgba(255,255,255,0.25);padding:3px 10px;border-radius:20px;font-size:11px;">${t.scene}</div>
  </div>`;

  // 环节1: 真人跟读视频
  html += `<div class="content-card">
    <div class="card-title"><span class="emoji">\u{1f3ac}</span> 真人跟读视频（核心环节 ~${v.duration}）</div>
    <div class="training-step">
      <div class="step-title">\u{1f4a1} 训练方法</div>
      <div class="step-guide">${v.desc}</div>
    </div>
    <div style="margin-top:12px;">
      <!-- B站视频嵌入 -->
      <div class="bilibili-container">
        <iframe 
          src="https://player.bilibili.com/player.html?bvid=${v.bvid}&page=1&high_quality=1&autoplay=0&danmaku=0"
          scrolling="no" 
          border="0" 
          frameborder="no" 
          framespacing="0" 
          allowfullscreen="true"
          class="bilibili-iframe"
        ></iframe>
      </div>
      <a href="https://www.bilibili.com/video/${v.bvid}" target="_blank" class="bilibili-app-btn">
        <span>\u{1f4f1}</span>
        <span>在B站App/浏览器中打开（推荐：可调速、全屏、后台播放）</span>
      </a>
    </div>
    <!-- 跟读步骤提示 -->
    <div class="shadow-step" style="margin-top:12px;">
      <div class="shadow-step-header">
        <span class="shadow-step-num">\u{1f4cb}</span>
        <span class="shadow-step-label">跟读步骤提示</span>
      </div>
      ${v.tips.map((tip, i) => `<div class="shadow-blind-line">
        <div class="shadow-blind-player">
          <span class="shadow-blind-num">${i+1}</span>
          <span style="font-size:13px;color:var(--text-main);">${tip}</span>
        </div>
      </div>`).join('')}
    </div>
  </div>`;

  // 环节2: 核心句式
  const p = t.patterns;
  html += `<div class="content-card">
    <div class="card-title"><span class="emoji">\u{1f3af}</span> ${p.title.replace(/^\u{1f3af} /,'')}</div>
    <div style="font-size:13px;color:var(--text-sub);margin-bottom:12px;line-height:1.6;">${p.desc}</div>
    ${p.items.map(item => `<div class="pattern-card">
      <div class="pattern-main">${item.pattern}</div>
      <div class="pattern-meaning">${item.meaning}</div>
      <div class="pattern-examples">
        ${item.examples.map(ex => `<div class="pattern-example">
          <span>\u{1f4ac}</span><span>${ex}</span>
        </div>`).join('')}
      </div>
    </div>`).join('')}
  </div>`;

  // 环节3: 自我复述
  const r = t.retell;
  html += `<div class="content-card">
    <div class="card-title"><span class="emoji">\u{1f5e3}\u{fe0f}</span> ${r.title.replace(/^\u{1f5e3}\u{fe0f} /,'')}</div>
    <div style="font-size:13px;color:var(--text-sub);margin-bottom:12px;line-height:1.6;">${r.desc}</div>
    ${r.prompts.map((prompt, i) => `<div class="retell-card" id="retell-${i}">
      <div class="retell-hint" onclick="toggleRetell(${i})">
        <span class="retell-num">${i+1}</span>
        <span class="retell-text">${prompt.hint}</span>
        <span class="retell-toggle" id="retell-toggle-${i}">\u25bc 展开回答</span>
      </div>
      <div class="retell-answer" id="retell-answer-${i}" style="display:none;">
        <div style="font-size:13px;font-weight:600;color:var(--pink-600);margin-bottom:4px;">\u{1f4ac} 参考回答：</div>
        <div style="font-size:14px;color:var(--text-main);line-height:1.8;">${prompt.answer}</div>
      </div>
    </div>`).join('')}
  </div>`;

  // 环节4: 自测
  if (t.quiz) html += renderQuiz(t.quiz);

  return html;
}

function toggleRetell(idx) {
  const answer = document.getElementById('retell-answer-' + idx);
  const toggle = document.getElementById('retell-toggle-' + idx);
  if (answer.style.display === 'none') {
    answer.style.display = 'block';
    toggle.textContent = '\u25b2 收起回答';
  } else {
    answer.style.display = 'none';
    toggle.textContent = '\u25bc 展开回答';
  }
}

// ===== 新闻 =====
function renderNews(mod) {
  let html = '';
  mod.news.forEach((n, i) => {
    html += `<div class="content-card">
      <div class="news-tag">${n.tag}</div>
      <div class="news-title">${n.title}</div>
      <div class="reading-text">${n.content.replace(/\n/g, '<br>')}</div>
    </div>`;
  });
  return html;
}

// ===== 知识拓展 =====
function renderKnowledge(mod) {
  let html = `<div class="content-card" style="background:linear-gradient(135deg,#FFB3C6,#FFC9DA);color:#fff;">
    <div style="font-size:16px;font-weight:800;">📚 知识库</div>
    <div style="font-size:13px;opacity:0.9;">共${mod.items.length}条知识 · 随时点开学 · 碎片时间看一看</div>
  </div>`;
  html += `<div class="content-card">
    ${mod.items.map((k, i) => `
      <div class="knowledge-item" onclick="toggleKnowledge(${i})">
        <div class="knowledge-header">
          <span class="knowledge-category">${k.category}</span>
          <span class="knowledge-title-text">${k.title}</span>
          <span class="knowledge-toggle" id="k-toggle-${i}">展开</span>
        </div>
        <div class="knowledge-content" id="k-content-${i}" style="display:none;">${(k.content || k.body || '').replace(/\n/g, '<br>')}</div>
      </div>
    `).join('')}
  </div>`;
  return html;
}

function toggleKnowledge(idx) {
  const content = document.getElementById(`k-content-${idx}`);
  const toggle = document.getElementById(`k-toggle-${idx}`);
  if (content.style.display === 'none') {
    content.style.display = 'block';
    toggle.textContent = '收起';
  } else {
    content.style.display = 'none';
    toggle.textContent = '展开';
  }
}

// ===== 塑形 =====
function renderFitness(mod) {
  const t = mod.today;
  let html = `<div class="content-card" style="background:linear-gradient(135deg,#FF9E80,#FFAB91);color:#fff;">
    <div style="font-size:18px;font-weight:800;margin-bottom:4px;">今日重点：${t.focus}</div>
    <div style="font-size:13px;opacity:0.9;">\u23f1 热身3分钟 + 力量训练15分钟 + 有氧15分钟 + 拉伸3分钟</div>
  </div>
  <div class="content-card">
    <div class="card-title"><span class="emoji">\u{1f525}</span> 热身</div>
    <div style="font-size:13px;color:var(--text-sub);">${t.warmup}</div>
  </div>
  <div class="content-card">
    <div class="card-title"><span class="emoji">\u{1f4aa}</span> 今日动作（照着练）</div>
    ${t.exercises.map((e, i) => `<div class="exercise-item">
      <div class="exercise-header">
        <span class="exercise-num">${i+1}</span>
        <span class="exercise-name">${e.name}</span>
        <span class="exercise-sets">${e.sets}</span>
      </div>
      <div class="exercise-detail">${e.detail}</div>
      <div class="exercise-points">\u{1f4aa} ${e.points}</div>
      <div class="exercise-breathing">\u{1fac1} ${e.breathing}</div>
    </div>`).join('')}
  </div>
  <div class="content-card">
    <div class="card-title"><span class="emoji">\u{25b6}\u{fe0f}</span> 跟练视频（点开跟着练）</div>
    <a class="video-link" href="${t.video.url}" target="_blank">\u{25b6}\u{fe0f} ${t.video.title}</a>
    <a class="video-link" href="${t.video2.url}" target="_blank">\u{25b6}\u{fe0f} ${t.video2.title}</a>
    ${t.video3 ? `<a class="video-link" href="${t.video3.url}" target="_blank">\u{25b6}\u{fe0f} ${t.video3.title}</a>` : ''}
  </div>
  ${t.cardio ? `<div class="content-card">
    <div class="card-title"><span class="emoji">\u{1f3c3}</span> 有氧建议</div>
    <div style="font-size:13px;color:var(--text-sub);line-height:1.8;">${t.cardio}</div>
  </div>` : ''}
  <div class="content-card">
    <div class="card-title"><span class="emoji">\u{1f9d8}</span> 练后拉伸</div>
    <div style="font-size:13px;color:var(--text-sub);line-height:1.8;">${t.stretch}</div>
  </div>`;

  if (mod.weeklyPlan) {
    html += `<div class="content-card">
      <div class="card-title"><span class="emoji">\u{1f4c5}</span> 每周计划</div>
      ${mod.weeklyPlan.map(w => `<div class="exercise-item" style="display:flex;align-items:center;gap:8px;">
        <span class="exercise-num">${w.day.replace('周','')}</span>
        <div style="flex:1;">
          <span style="font-size:14px;font-weight:600;color:var(--text-main);">${w.day} </span>
          <span style="font-size:13px;color:var(--text-sub);">${w.focus}</span>
        </div>
        <span style="font-size:11px;color:var(--pink-500);">${w.video}</span>
      </div>`).join('')}
    </div>`;
  }

  if (mod.diet) {
    const d = mod.diet;
    html += `<div class="content-card">
      <div class="card-title"><span class="emoji">\u{1f95d}</span> ${d.title}</div>
      <div class="diet-row"><span class="diet-label">早餐</span><span>${d.breakfast}</span></div>
      <div class="diet-row"><span class="diet-label">午餐</span><span>${d.lunch}</span></div>
      <div class="diet-row"><span class="diet-label">晚餐</span><span>${d.dinner}</span></div>
      <div class="diet-row"><span class="diet-label">加餐</span><span>${d.snack}</span></div>
      <div style="margin-top:12px;">${d.principles.map(p => `<div class="principle-item">\u2713 ${p}</div>`).join('')}</div>
    </div>`;
  }

  if (mod.tips) {
    html += `<div class="tips-card">
      <div class="card-title"><span class="emoji">\u{1f4a1}</span> 塑形小贴士</div>
      ${mod.tips.map(t => `<div class="tip-item">${t}</div>`).join('')}
    </div>`;
  }

  if (mod.quiz) html += renderQuiz(mod.quiz);
  return html;
}

// ===== 表达 =====
function renderSpeech(mod) {
  const t = mod.today;
  let html = `<div class="content-card" style="background:linear-gradient(135deg,#FF6B9D,#FF85B0);color:#fff;">
    <div style="font-size:18px;font-weight:800;margin-bottom:4px;">${t.theme}</div>
    <div style="font-size:13px;opacity:0.9;">${t.themeDesc}</div>
  </div>`;

  // 任务一：朗读
  html += `<div class="content-card">
    <div class="card-title">${t.task1.title}</div>
    <div style="font-size:13px;color:var(--text-sub);margin-bottom:8px;">${t.task1.desc}</div>
    <div class="reading-text">${t.task1.text.replace(/\n/g, '<br>')}</div>
  </div>`;

  // 任务二：镜子练习
  html += `<div class="content-card">
    <div class="card-title">${t.task2.title}</div>
    <div style="font-size:13px;color:var(--text-sub);margin-bottom:8px;">${t.task2.desc}</div>
    <div class="framework-box">${t.task2.framework.replace(/\n/g, '<br>')}</div>
    <div style="font-size:15px;font-weight:700;color:var(--pink-600);margin:12px 0 8px;">${t.task2.topic}</div>
    <div class="example-box">${t.task2.example.replace(/\n/g, '<br>')}</div>
  </div>`;

  // 任务三：即兴
  html += `<div class="content-card">
    <div class="card-title">${t.task3.title}</div>
    <div style="font-size:13px;color:var(--text-sub);margin-bottom:10px;">${t.task3.desc}</div>
    ${t.task3.topics.map((topic, i) => `<div class="topic-item"><span class="topic-num">${i+1}</span><span>${topic}</span></div>`).join('')}
  </div>`;

  // 任务四：高情商
  html += `<div class="content-card">
    <div class="card-title">${t.task4.title}</div>
    <div style="font-size:14px;font-weight:600;color:var(--text-main);margin-bottom:8px;">${t.task4.scenario}</div>
    <div class="bad-response">${t.task4.bad.replace(/\n/g, '<br>')}</div>
    <div class="good-response">${t.task4.good.replace(/\n/g, '<br>')}</div>
  </div>`;

  if (mod.quiz) html += renderQuiz(mod.quiz);
  return html;
}

// ===== 尤克里里 =====
function renderUkulele(mod) {
  return `<div class="content-card" style="text-align:center;padding:30px 16px;">
    <div style="font-size:48px;margin-bottom:12px;">🎸</div>
    <div style="font-size:16px;font-weight:700;color:var(--text-main);margin-bottom:8px;">尤克里里每日打卡</div>
    <div style="font-size:13px;color:var(--text-sub);line-height:1.8;">每天练琴，保持手感<br>练完点击上方打卡按钮<br>可以记录今天练了多久、学了什么</div>
  </div>
  <div class="tips-card">
    <div class="card-title"><span class="emoji">💡</span> 小贴士</div>
    <div class="tip-item">🔁 每天哪怕只练10分钟，手感就不会丢</div>
    <div class="tip-item">📹 录视频回看，进步更快</div>
    <div class="tip-item">🎵 先慢后快，熟练了再加速</div>
  </div>`;
}

// ===== 自测 =====
function renderQuiz(quiz) {
  const titleParts = quiz.title.split(' ');
  const emoji = titleParts[0];
  const text = titleParts.slice(1).join(' ');
  return `<div class="content-card quiz-card">
    <div class="card-title"><span class="emoji">${emoji}</span> ${text}</div>
    ${quiz.questions.map((q, i) => `<div class="quiz-item">
      <div class="quiz-q" onclick="toggleAnswer(${i})">
        <span class="quiz-num">Q${i+1}</span>
        <span class="quiz-text">${q.q}</span>
        <span class="quiz-toggle" id="toggle-${i}">查看答案</span>
      </div>
      <div class="quiz-a" id="answer-${i}" style="display:none;">${q.a}</div>
    </div>`).join('')}
  </div>`;
}

function toggleAnswer(idx) {
  const answer = document.getElementById(`answer-${idx}`);
  const toggle = document.getElementById(`toggle-${idx}`);
  if (answer.style.display === 'none') { answer.style.display = 'block'; toggle.textContent = '收起'; }
  else { answer.style.display = 'none'; toggle.textContent = '查看答案'; }
}

// ===== 同步设置 =====
function toggleSyncSettings() {
  const modal = document.getElementById('sync-modal');
  modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
  // Update status
  const statusEl = document.getElementById('sync-status');
  if (GIST_TOKEN) {
    const gistId = localStorage.getItem('xiaopaifu_gist_id');
    statusEl.textContent = gistId ? '✅ 已连接（Gist: ' + gistId.substring(0,8) + '...）' : '✅ Token 已设置';
    statusEl.style.color = '#4CAF50';
  } else {
    statusEl.textContent = '未设置';
    statusEl.style.color = 'var(--text-light)';
  }
}

function saveSyncToken() {
  const input = document.getElementById('sync-token-input');
  const token = input.value.trim();
  if (!token) { alert('请粘贴 GitHub Token'); return; }
  if (setSyncToken(token)) {
    input.value = '';
    toggleSyncSettings();
    alert('✅ 云同步已开启！打卡数据将自动在手机和电脑间同步。');
  } else {
    alert('Token 格式不正确');
  }
}

function clearSyncToken() {
  if (confirm('确定清除同步设置吗？本地数据不会丢失。')) {
    clearSync();
    document.getElementById('sync-token-input').value = '';
    toggleSyncSettings();
  }
}

// ===== PWA =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(err => console.log('SW:', err)); });
}

// ===== 初始化 =====
loadData(); renderNav(); renderMain();

let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
