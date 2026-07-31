(() => {
  'use strict';

  const STORAGE_KEY = 'nihongo-lab-state-v1';
  const DAY = 24 * 60 * 60 * 1000;
  const titles = { home: '今日学习', vocab: '单词与汉字', dialogue: '场景对话', review: '复习训练', settings: '设置' };

  const app = {
    route: 'home',
    detailId: null,
    vocab: [],
    dialogues: [],
    vocabFilter: 'all',
    dialogueFilter: 'all',
    search: '',
    reviewQueue: [],
    reviewIndex: 0,
    reviewRevealed: false,
    state: loadState()
  };

  const main = document.getElementById('main-content');
  const title = document.getElementById('page-title');
  const toast = document.getElementById('toast');
  const importFile = document.getElementById('import-file');

  function defaultState() {
    return {
      wordProgress: {},
      dialogueProgress: {},
      settings: { showReading: true, showChinese: true, speechRate: 0.9, dark: false },
      activityDates: [],
      createdAt: new Date().toISOString()
    };
  }

  function loadState() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return { ...defaultState(), ...value, settings: { ...defaultState().settings, ...(value?.settings || {}) } };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.state));
  }

  function markActivity() {
    const today = new Date().toISOString().slice(0, 10);
    if (!app.state.activityDates.includes(today)) {
      app.state.activityDates.push(today);
      app.state.activityDates = app.state.activityDates.slice(-180);
      saveState();
    }
  }

  function allWords() {
    return app.vocab.flatMap(group => group.words.map(word => ({ ...word, kanji: group.kanji, groupId: group.id })));
  }

  function getProgress(wordId) {
    return app.state.wordProgress[wordId] || { repetitions: 0, nextReview: null, favorite: false, lastGrade: null, reviews: 0 };
  }

  function isDue(word) {
    const p = getProgress(word.id);
    return !p.nextReview || new Date(p.nextReview).getTime() <= Date.now();
  }

  function dueWords() {
    return allWords().filter(isDue);
  }

  function learnedCount() {
    return Object.values(app.state.wordProgress).filter(p => p.repetitions > 0).length;
  }

  function favoriteCount() {
    return Object.values(app.state.wordProgress).filter(p => p.favorite).length;
  }

  function streakCount() {
    const dates = new Set(app.state.activityDates);
    let count = 0;
    const cursor = new Date();
    for (let i = 0; i < 365; i++) {
      const key = cursor.toISOString().slice(0, 10);
      if (!dates.has(key)) break;
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function navigate(route, detailId = null) {
    app.route = route;
    app.detailId = detailId;
    app.reviewRevealed = false;
    title.textContent = titles[route] || '日语随身学';
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route));
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function render() {
    if (app.detailId && app.route === 'vocab') return renderVocabDetail(app.detailId);
    if (app.detailId && app.route === 'dialogue') return renderDialogueDetail(app.detailId);
    const renderers = { home: renderHome, vocab: renderVocab, dialogue: renderDialogues, review: renderReview, settings: renderSettings };
    (renderers[app.route] || renderHome)();
  }

  function renderHome() {
    const due = dueWords().length;
    const recommended = app.vocab.slice(0, 3);
    main.innerHTML = `
      <section class="hero">
        <h2>${greeting()}，今天也学一点。</h2>
        <p>从句子理解单词，把训读、音读和实际工作表达连接起来。</p>
        <div class="hero-actions">
          <button class="primary-button" data-action="start-review">开始今日复习（${due}）</button>
          <button class="secondary-button" data-route-link="dialogue">练习 IT 对话</button>
        </div>
      </section>

      <div class="stats-grid">
        ${statCard(due, '待复习')}
        ${statCard(learnedCount(), '已学习单词')}
        ${statCard(favoriteCount(), '收藏')}
        ${statCard(streakCount(), '连续学习天数')}
      </div>

      <section class="section">
        <div class="section-heading"><h2>今日推荐汉字</h2><button class="link-button" data-route-link="vocab">查看全部</button></div>
        <div class="card-grid">
          ${recommended.map(group => kanjiCard(group)).join('')}
        </div>
      </section>

      <section class="section">
        <div class="section-heading"><h2>工作场景</h2><p>适合口头练习</p></div>
        <div class="card-grid two">
          ${app.dialogues.filter(d => d.category === 'it').slice(0, 2).map(dialogueSummaryCard).join('')}
        </div>
      </section>`;
  }

  function statCard(value, label) {
    return `<div class="stat-card"><strong>${value}</strong><span>${label}</span></div>`;
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 11) return '早上好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function kanjiCard(group) {
    const kun = group.words.filter(w => w.type === 'kun').map(w => w.word).slice(0, 2).join('・') || '—';
    const on = group.words.filter(w => w.type === 'on').map(w => w.word).slice(0, 2).join('・') || '—';
    return `<button class="card kanji-card" data-vocab-detail="${escapeHtml(group.id)}" type="button">
      <span class="kanji-glyph">${escapeHtml(group.kanji)}</span>
      <span style="text-align:left"><strong>${escapeHtml(group.meanings.join('、'))}</strong><small style="display:block;color:var(--muted);margin-top:6px">训：${escapeHtml(kun)}<br>音：${escapeHtml(on)}</small></span>
      <span class="chevron">›</span>
    </button>`;
  }

  function renderVocab() {
    const query = app.search.trim().toLowerCase();
    const filtered = app.vocab.filter(group => {
      const text = [group.kanji, group.meanings.join(' '), ...group.words.flatMap(w => [w.word, w.reading, w.meaning, ...(w.tags || [])])].join(' ').toLowerCase();
      const matchSearch = !query || text.includes(query);
      const matchFilter = app.vocabFilter === 'all' || group.words.some(w => (w.tags || []).some(t => t.toLowerCase() === app.vocabFilter));
      return matchSearch && matchFilter;
    });

    main.innerHTML = `
      <div class="search-row">
        <input id="vocab-search" class="search-input" value="${escapeHtml(app.search)}" placeholder="搜索汉字、单词、读音或标签" />
        <button class="ghost-button" data-action="clear-search">清除</button>
      </div>
      <div class="filter-pills">
        ${filterPill('all','全部',app.vocabFilter)}
        ${filterPill('日常','日常',app.vocabFilter)}
        ${filterPill('it','IT',app.vocabFilter)}
        ${filterPill('git','Git',app.vocabFilter)}
        ${filterPill('工作','工作',app.vocabFilter)}
        ${filterPill('CI/CD','CI/CD',app.vocabFilter)}
        ${filterPill('aws','AWS',app.vocabFilter)}
      </div>
      <div class="card-grid">
        ${filtered.length ? filtered.map(kanjiCard).join('') : emptyState('没有匹配内容','换一个关键词或筛选条件试试。')}
      </div>`;
  }

  function filterPill(value, label, active) {
    return `<button class="pill ${active === value ? 'active' : ''}" data-vocab-filter="${value}">${label}</button>`;
  }

  function renderVocabDetail(groupId) {
    const group = app.vocab.find(item => item.id === groupId);
    if (!group) return navigate('vocab');
    const kunWords = group.words.filter(w => w.type === 'kun');
    const onWords = group.words.filter(w => w.type === 'on');
    main.innerHTML = `
      <button class="ghost-button" data-action="back-vocab">← 返回单词列表</button>
      <section class="card" style="margin-top:12px">
        <div class="detail-header">
          <div class="detail-kanji">${escapeHtml(group.kanji)}</div>
          <div><p class="eyebrow">KANJI GROUP</p><h2>${escapeHtml(group.meanings.join('・'))}</h2><p>${escapeHtml(group.level)}</p></div>
        </div>
      </section>
      ${readingBlock('训读词', '訓読み', kunWords)}
      ${readingBlock('音读词', '音読み', onWords)}
    `;
  }

  function readingBlock(cn, jp, words) {
    return `<section class="reading-section">
      <div class="reading-title"><strong>${cn}</strong><span class="tag">${jp}</span></div>
      ${words.map(vocabItem).join('') || emptyState('暂无内容','可在 vocabulary.json 中继续添加。')}
    </section>`;
  }

  function vocabItem(word) {
    const progress = getProgress(word.id);
    const sentences = Array.isArray(word.sentences) ? word.sentences : [];
    return `<article class="vocab-item">
      <div class="vocab-word"><strong>${escapeHtml(word.word)}</strong><span>${escapeHtml(word.reading)}</span><span class="tag">${escapeHtml(word.meaning)}</span></div>
      <div class="tag-row">${(word.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
      ${sentences.map((sentence, index) => `<div class="sentence-box" style="margin-top:${index === 0 ? '12px' : '10px'}">
        <div class="sentence-jp"><span class="sentence-number">例${index + 1}</span>${escapeHtml(sentence.jp)}</div>
        ${app.state.settings.showReading ? `<div class="sentence-reading">${escapeHtml(sentence.reading || '')}</div>` : ''}
        ${app.state.settings.showChinese ? `<div class="sentence-zh">${escapeHtml(sentence.zh || '')}</div>` : ''}
        <div class="inline-actions" style="margin-top:8px">
          <button class="mini-button" data-speak="${escapeHtml(sentence.jp)}">🔊 例句${index + 1}</button>
          <button class="mini-button" data-speak-slow="${escapeHtml(sentence.jp)}">🐢 慢速</button>
        </div>
      </div>`).join('')}
      <div class="inline-actions" style="margin-top:12px">
        <button class="mini-button" data-speak="${escapeHtml(word.word)}">🔊 单词</button>
        <button class="mini-button favorite ${progress.favorite ? 'active' : ''}" data-favorite="${escapeHtml(word.id)}">${progress.favorite ? '★ 已收藏' : '☆ 收藏'}</button>
      </div>
    </article>`;
  }

  function renderDialogues() {
    const data = app.dialogues.filter(d => app.dialogueFilter === 'all' || d.category === app.dialogueFilter);
    main.innerHTML = `
      <div class="filter-pills">
        ${dialoguePill('all','全部')}
        ${dialoguePill('daily','日常生活')}
        ${dialoguePill('it','IT工作')}
      </div>
      <div class="card-grid two">
        ${data.map(dialogueSummaryCard).join('')}
      </div>`;
  }

  function dialoguePill(value, label) {
    return `<button class="pill ${app.dialogueFilter === value ? 'active' : ''}" data-dialogue-filter="${value}">${label}</button>`;
  }

  function dialogueSummaryCard(d) {
    const completed = app.state.dialogueProgress[d.id]?.completed;
    return `<button class="card dialogue-card" data-dialogue-detail="${escapeHtml(d.id)}" type="button" style="text-align:left">
      <div class="dialogue-meta"><span>${d.category === 'it' ? 'IT工作' : '日常生活'}</span><span>${escapeHtml(d.level)}</span></div>
      <h3 style="margin-top:10px">${escapeHtml(d.title)} ${completed ? '✓' : ''}</h3>
      <p>${escapeHtml(d.situation)}</p>
      <div class="tag-row">${d.keywords.slice(0,3).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
    </button>`;
  }

  function renderDialogueDetail(id) {
    const d = app.dialogues.find(item => item.id === id);
    if (!d) return navigate('dialogue');
    main.innerHTML = `
      <button class="ghost-button" data-action="back-dialogue">← 返回对话列表</button>
      <section class="card" style="margin-top:12px">
        <p class="eyebrow">${d.category === 'it' ? 'IT WORKPLACE' : 'DAILY LIFE'}</p>
        <h2 style="margin:0 0 8px">${escapeHtml(d.title)}</h2>
        <p>${escapeHtml(d.situation)}</p>
        <div class="inline-actions">
          <button class="primary-button" data-speak="${escapeHtml(d.lines.map(l => l.jp).join('。'))}">▶ 播放完整对话</button>
          <button class="ghost-button" data-dialogue-complete="${escapeHtml(d.id)}">标记已练习</button>
        </div>
      </section>
      <section class="card dialogue-lines" style="margin-top:14px">
        ${d.lines.map((line,index) => `<div class="dialogue-line">
          <div class="speaker">${escapeHtml(line.speaker)}</div>
          <div><div class="line-jp">${escapeHtml(line.jp)}</div>${app.state.settings.showChinese ? `<div class="line-zh">${escapeHtml(line.zh)}</div>` : ''}<button class="mini-button" style="margin-top:7px" data-speak="${escapeHtml(line.jp)}">🔊 第${index+1}句</button></div>
        </div>`).join('')}
      </section>
      <section class="section">
        <div class="section-heading"><h2>重点表达</h2></div>
        <div class="card"><div class="tag-row">${d.keywords.map(k => `<span class="tag">${escapeHtml(k)}</span>`).join('')}</div></div>
      </section>
      ${Array.isArray(d.learningPoints) && d.learningPoints.length ? `<section class="section">
        <div class="section-heading"><h2>学习要点</h2></div>
        <div class="card learning-points">${d.learningPoints.map((point,index) => `<p><strong>${index + 1}.</strong> ${escapeHtml(point)}</p>`).join('')}</div>
      </section>` : ''}
      ${Array.isArray(d.expressions) && d.expressions.length ? `<section class="section">
        <div class="section-heading"><h2>可替换表达</h2></div>
        <div class="card expression-list">${d.expressions.map(item => `<div class="expression-item"><span class="tag">${escapeHtml(item.label || '表达')}</span><div class="line-jp">${escapeHtml(item.jp || '')}</div>${app.state.settings.showChinese ? `<div class="line-zh">${escapeHtml(item.zh || '')}</div>` : ''}<button class="mini-button" style="margin-top:7px" data-speak="${escapeHtml(item.jp || '')}">🔊 播放</button></div>`).join('')}</div>
      </section>` : ''}`;
  }

  function prepareReviewQueue() {
    const due = dueWords();
    app.reviewQueue = (due.length ? due : allWords()).sort(() => Math.random() - 0.5).slice(0, 20);
    app.reviewIndex = 0;
    app.reviewRevealed = false;
  }

  function renderReview() {
    if (!app.reviewQueue.length || app.reviewIndex >= app.reviewQueue.length) {
      if (app.reviewQueue.length && app.reviewIndex >= app.reviewQueue.length) {
        main.innerHTML = `<section class="card review-card"><div class="review-kanji">✓</div><h2>本轮完成</h2><p>学习记录已经保存在当前设备。</p><button class="primary-button" data-action="restart-review">再练一轮</button></section>`;
        return;
      }
      prepareReviewQueue();
    }
    const word = app.reviewQueue[app.reviewIndex];
    if (!word) {
      main.innerHTML = emptyState('暂无复习内容','请先在单词页面学习一些内容。');
      return;
    }
    const sentence = word.sentences[0];
    const percent = Math.round((app.reviewIndex / app.reviewQueue.length) * 100);
    main.innerHTML = `
      <div class="progress"><span style="width:${percent}%"></span></div>
      <p style="text-align:center;color:var(--muted);font-size:13px">${app.reviewIndex + 1} / ${app.reviewQueue.length}</p>
      <section class="card review-card">
        <div class="review-kanji">${escapeHtml(word.kanji)}</div>
        <div class="review-question">${app.reviewRevealed ? escapeHtml(word.word) : '这个词怎么读？'}</div>
        <div class="sentence-box"><div class="sentence-jp">${escapeHtml(sentence.jp.replace(word.word, '＿＿＿'))}</div></div>
        ${app.reviewRevealed ? `<div class="review-answer"><h3>${escapeHtml(word.word)}（${escapeHtml(word.reading)}）</h3><p>${escapeHtml(word.meaning)}</p><div class="sentence-box"><div class="sentence-jp">${escapeHtml(sentence.jp)}</div>${app.state.settings.showReading ? `<div class="sentence-reading">${escapeHtml(sentence.reading)}</div>` : ''}${app.state.settings.showChinese ? `<div class="sentence-zh">${escapeHtml(sentence.zh)}</div>` : ''}</div><button class="mini-button" data-speak="${escapeHtml(sentence.jp)}">🔊 播放</button><div class="grade-grid"><button class="grade-button again" data-grade="again">完全不会</button><button class="grade-button hard" data-grade="hard">有点模糊</button><button class="grade-button good" data-grade="good">基本记住</button><button class="grade-button easy" data-grade="easy">很熟练</button></div></div>` : `<button class="primary-button" data-action="reveal-answer">显示答案</button>`}
      </section>`;
  }

  function gradeWord(grade) {
    const word = app.reviewQueue[app.reviewIndex];
    if (!word) return;
    const old = getProgress(word.id);
    const intervals = { again: 0, hard: 1, good: Math.max(3, old.repetitions * 3), easy: Math.max(7, old.repetitions * 5) };
    const next = new Date(Date.now() + intervals[grade] * DAY);
    if (grade === 'again') next.setMinutes(next.getMinutes() + 20);
    app.state.wordProgress[word.id] = {
      ...old,
      repetitions: grade === 'again' ? 0 : old.repetitions + 1,
      reviews: (old.reviews || 0) + 1,
      lastGrade: grade,
      lastReviewed: new Date().toISOString(),
      nextReview: next.toISOString()
    };
    markActivity();
    saveState();
    app.reviewIndex += 1;
    app.reviewRevealed = false;
    renderReview();
  }

  function renderSettings() {
    const s = app.state.settings;
    main.innerHTML = `
      <section class="card">
        ${settingToggle('显示假名', '在例句下显示平假名读音', 'showReading', s.showReading)}
        ${settingToggle('显示中文', '显示例句和对话的中文含义', 'showChinese', s.showChinese)}
        ${settingToggle('深色模式', '适合夜间学习', 'dark', s.dark)}
        <div class="setting-row"><div><strong>朗读速度</strong><small>当前 ${s.speechRate} 倍</small></div><select id="speech-rate" class="select-input" style="width:120px"><option value="0.7" ${s.speechRate==0.7?'selected':''}>慢速</option><option value="0.9" ${s.speechRate==0.9?'selected':''}>标准</option><option value="1.1" ${s.speechRate==1.1?'selected':''}>快速</option></select></div>
      </section>
      <section class="section">
        <div class="section-heading"><h2>数据管理</h2></div>
        <div class="card">
          <div class="inline-actions">
            <button class="ghost-button" data-action="export-data">导出学习记录</button>
            <button class="ghost-button" data-action="import-data">导入学习记录</button>
            <button class="ghost-button" data-action="reset-data">清空学习记录</button>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="section-heading"><h2>安装说明</h2></div>
        <div class="card"><p>在 iPhone Safari 中打开本页面，点击分享按钮，再选择“添加到主屏幕”。首次完整打开后，可离线使用已缓存内容。</p></div>
      </section>
      <section class="section"><div class="card"><p>版本：Content Expansion 2.0<br>教材：${app.vocab.length} 个汉字组，${allWords().length} 个单词，${app.dialogues.length} 个对话场景。</p></div></section>`;
  }

  function settingToggle(titleText, description, key, active) {
    return `<div class="setting-row"><div><strong>${titleText}</strong><small>${description}</small></div><button class="switch ${active ? 'active' : ''}" data-setting-toggle="${key}"><span></span></button></div>`;
  }

  function emptyState(head, body) {
    return `<div class="empty"><strong>${escapeHtml(head)}</strong>${escapeHtml(body)}</div>`;
  }

  function speak(text, slow = false) {
    if (!('speechSynthesis' in window)) return showToast('当前浏览器不支持语音朗读');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = slow ? 0.65 : Number(app.state.settings.speechRate || 0.9);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(v => v.lang === 'ja-JP') || voices.find(v => v.lang.startsWith('ja')) || null;
    window.speechSynthesis.speak(utterance);
  }

  function toggleFavorite(wordId) {
    const p = getProgress(wordId);
    app.state.wordProgress[wordId] = { ...p, favorite: !p.favorite };
    markActivity();
    saveState();
    render();
  }

  function exportData() {
    const payload = { app: 'nihongo-lab', version: 1, exportedAt: new Date().toISOString(), state: app.state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nihongo-learning-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('学习记录已导出');
  }

  async function importData(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const state = parsed.state || parsed;
      if (!state.settings || !state.wordProgress) throw new Error('invalid');
      app.state = { ...defaultState(), ...state, settings: { ...defaultState().settings, ...state.settings } };
      saveState();
      applyTheme();
      render();
      showToast('学习记录已导入');
    } catch {
      showToast('导入失败：文件格式不正确');
    }
  }

  function applyTheme() {
    document.body.classList.toggle('dark', Boolean(app.state.settings.dark));
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;

    if (target.dataset.route) navigate(target.dataset.route);
    if (target.dataset.routeLink) navigate(target.dataset.routeLink);
    if (target.dataset.vocabDetail) navigate('vocab', target.dataset.vocabDetail);
    if (target.dataset.dialogueDetail) navigate('dialogue', target.dataset.dialogueDetail);
    if (target.dataset.vocabFilter) { app.vocabFilter = target.dataset.vocabFilter; renderVocab(); }
    if (target.dataset.dialogueFilter) { app.dialogueFilter = target.dataset.dialogueFilter; renderDialogues(); }
    if (target.dataset.speak) speak(target.dataset.speak);
    if (target.dataset.speakSlow) speak(target.dataset.speakSlow, true);
    if (target.dataset.favorite) toggleFavorite(target.dataset.favorite);
    if (target.dataset.grade) gradeWord(target.dataset.grade);
    if (target.dataset.dialogueComplete) {
      app.state.dialogueProgress[target.dataset.dialogueComplete] = { completed: true, completedAt: new Date().toISOString() };
      markActivity(); saveState(); showToast('已记录本次练习'); render();
    }
    if (target.dataset.settingToggle) {
      const key = target.dataset.settingToggle;
      app.state.settings[key] = !app.state.settings[key];
      saveState(); applyTheme(); renderSettings();
    }

    const action = target.dataset.action;
    if (action === 'start-review') { prepareReviewQueue(); navigate('review'); }
    if (action === 'restart-review') { prepareReviewQueue(); renderReview(); }
    if (action === 'reveal-answer') { app.reviewRevealed = true; renderReview(); }
    if (action === 'clear-search') { app.search = ''; renderVocab(); }
    if (action === 'back-vocab') { app.detailId = null; renderVocab(); }
    if (action === 'back-dialogue') { app.detailId = null; renderDialogues(); }
    if (action === 'export-data') exportData();
    if (action === 'import-data') importFile.click();
    if (action === 'reset-data' && confirm('确定清空全部学习记录吗？教材内容不会被删除。')) {
      app.state = defaultState(); saveState(); applyTheme(); renderSettings(); showToast('学习记录已清空');
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'vocab-search') {
      app.search = event.target.value;
      clearTimeout(app.searchTimer);
      app.searchTimer = setTimeout(renderVocab, 180);
    }
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'speech-rate') {
      app.state.settings.speechRate = Number(event.target.value);
      saveState(); renderSettings();
    }
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    app.state.settings.dark = !app.state.settings.dark;
    saveState(); applyTheme(); render();
  });

  importFile.addEventListener('change', () => {
    if (importFile.files[0]) importData(importFile.files[0]);
    importFile.value = '';
  });

  async function init() {
    applyTheme();
    try {
      if (Array.isArray(window.__VOCAB__) && Array.isArray(window.__DIALOGUES__)) {
        app.vocab = window.__VOCAB__;
        app.dialogues = window.__DIALOGUES__;
      } else {
        const [vocabResponse, dialogueResponse] = await Promise.all([
          fetch('./data/vocabulary.json'),
          fetch('./data/dialogues.json')
        ]);
        if (!vocabResponse.ok || !dialogueResponse.ok) throw new Error('data load failed');
        app.vocab = await vocabResponse.json();
        app.dialogues = await dialogueResponse.json();
      }
      render();
    } catch (error) {
      console.error(error);
      main.innerHTML = emptyState('教材加载失败', '请通过本地服务器或部署后的 HTTPS 地址打开，不要直接双击 index.html。');
    }

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./service-worker.js').catch(console.warn);
    }
  }

  init();
})();
