(() => {
  'use strict';

  const APP_VERSION = '5.0.0';
  const STATE_SCHEMA_VERSION = 3;
  const DB_NAME = 'nihongo-lab';
  const DB_VERSION = 3;
  const LEGACY_STORAGE_KEY = 'nihongo-lab-state-v1';
  const MIRROR_STORAGE_KEY = 'nihongo-lab-state-v3-mirror';
  const DAY = 86400000;
  const titles = { home:'今日学习', vocab:'单词与汉字', dialogue:'场景对话', drill:'商务专项', review:'复习训练', settings:'设置' };

  const app = {
    route:'home', detailId:null, catalog:null, aliases:null,
    packs:new Map(), groups:new Map(), words:new Map(), dialogues:new Map(), expressions:new Map(), mistakes:new Map(),
    vocabFilter:'all', dialogueFilter:'all', drillMode:'expression', search:'', reviewQueue:[], reviewIndex:0, reviewRevealed:false,
    state:null, registration:null, waitingWorker:null, db:null, validation:null
  };

  const main=document.getElementById('main-content');
  const title=document.getElementById('page-title');
  const toast=document.getElementById('toast');
  const importFile=document.getElementById('import-file');
  const updateBanner=document.getElementById('update-banner');
  const updateMessage=document.getElementById('update-message');

  function defaultState(){ return {
    schemaVersion:STATE_SCHEMA_VERSION, wordProgress:{}, dialogueProgress:{},
    settings:{ showReading:true, showChinese:true, speechRate:0.9, dark:false, focusWeights:{business:35,it:30,jlpt:20,daily:15}},
    activityDates:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    lastContentVersion:null, lastAppVersion:APP_VERSION, migrationHistory:[]
  };}

  function openDb(){ return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains('state')) db.createObjectStore('state'); if(!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots',{keyPath:'id'}); if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta'); };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });}
  function idbGet(store,key){ return new Promise((resolve,reject)=>{ const tx=app.db.transaction(store,'readonly'); const req=tx.objectStore(store).get(key); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });}
  function idbPut(store,value,key){ return new Promise((resolve,reject)=>{ const tx=app.db.transaction(store,'readwrite'); const req=key===undefined?tx.objectStore(store).put(value):tx.objectStore(store).put(value,key); req.onsuccess=()=>resolve(); req.onerror=()=>reject(req.error); });}
  function idbDelete(store,key){ return new Promise((resolve,reject)=>{ const tx=app.db.transaction(store,'readwrite'); const req=tx.objectStore(store).delete(key); req.onsuccess=()=>resolve(); req.onerror=()=>reject(req.error); });}
  function idbAll(store){ return new Promise((resolve,reject)=>{ const tx=app.db.transaction(store,'readonly'); const req=tx.objectStore(store).getAll(); req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error); });}

  async function loadState(){
    let state=await idbGet('state','current');
    if(!state){
      const mirror=safeParse(localStorage.getItem(MIRROR_STORAGE_KEY));
      const legacy=safeParse(localStorage.getItem(LEGACY_STORAGE_KEY));
      state=mirror||legacy||defaultState();
      state=await migrateState(state, legacy?'legacy-localStorage':'mirror');
      await idbPut('state',state,'current');
      localStorage.setItem(MIRROR_STORAGE_KEY,JSON.stringify(state));
    } else state=await migrateState(state,'indexedDB');
    return state;
  }
  async function migrateState(input,source){
    const base=defaultState();
    const state={...base,...(input||{}),settings:{...base.settings,...((input||{}).settings||{})}};
    const from=Number(state.schemaVersion||1);
    if(from<3){
      const aliases=app.aliases||{wordIds:{},dialogueIds:{}};
      const migratedWords={}; Object.entries(state.wordProgress||{}).forEach(([id,v])=>{
        const target=aliases.wordIds?.[id]||id, prior=migratedWords[target];
        if(!prior){ migratedWords[target]=v; return; }
        const priorReviews=Number(prior.reviews||0), nextReviews=Number(v.reviews||0);
        migratedWords[target]={
          ...(priorReviews>=nextReviews?prior:v),
          favorite:!!prior.favorite||!!v.favorite,
          reviews:priorReviews+nextReviews,
          repetitions:Math.max(Number(prior.repetitions||0),Number(v.repetitions||0)),
          lastReviewed:(()=>{const xs=[prior.lastReviewed,v.lastReviewed].filter(Boolean).sort();return xs.length?xs[xs.length-1]:null;})(),
          nextReview:(()=>{const xs=[prior.nextReview,v.nextReview].filter(Boolean).sort();return xs.length?xs[0]:null;})()
        };
      });
      const migratedDialogues={}; Object.entries(state.dialogueProgress||{}).forEach(([id,v])=>migratedDialogues[aliases.dialogueIds?.[id]||id]=v);
      state.wordProgress=migratedWords; state.dialogueProgress=migratedDialogues;
      state.migrationHistory=[...(state.migrationHistory||[]),{from,to:3,source,at:new Date().toISOString()}];
      state.schemaVersion=3;
    }
    return state;
  }
  async function saveState(snapshot=true){
    app.state.updatedAt=new Date().toISOString();
    await idbPut('state',app.state,'current');
    localStorage.setItem(MIRROR_STORAGE_KEY,JSON.stringify(app.state));
    if(snapshot) await ensureDailySnapshot('auto');
  }
  async function ensureDailySnapshot(reason){
    const day=new Date().toISOString().slice(0,10); const id=`${reason}-${day}`;
    const exists=await idbGet('snapshots',id); if(!exists) await idbPut('snapshots',{id,reason,createdAt:new Date().toISOString(),state:JSON.parse(JSON.stringify(app.state))});
    const all=(await idbAll('snapshots')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    for(const x of all.slice(8)) await idbDelete('snapshots',x.id);
  }

  function safeParse(x){ try{return x?JSON.parse(x):null;}catch{return null;} }
  function escapeHtml(value=''){ return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
  function showToast(msg){ toast.textContent=msg; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>toast.classList.remove('show'),2200); }
  function compareVersions(a,b){ const A=String(a).split('.').map(Number),B=String(b).split('.').map(Number); for(let i=0;i<Math.max(A.length,B.length);i++){const d=(A[i]||0)-(B[i]||0); if(d)return d;} return 0; }

  async function fetchJson(path,noCache=false){
    const url=noCache?`${path}${path.includes('?')?'&':'?'}_=${Date.now()}`:path;
    const res=await fetch(url,{cache:noCache?'no-store':'default'}); if(!res.ok) throw new Error(`${path}: HTTP ${res.status}`); return res.json();
  }
  async function loadCatalog(noCache=false){
    const catalog=await fetchJson('./data/catalog.json',noCache); validateCatalog(catalog); app.catalog=catalog;
    app.aliases=await fetchJson(catalog.idAliasesPath||'./data/id-aliases.json',noCache);
  }
  function validateCatalog(c){ if(!c||c.schemaVersion!==3||!Array.isArray(c.packs)) throw new Error('教材目录格式不正确'); const ids=new Set(); c.packs.forEach(p=>{if(!p.id||!p.path||ids.has(p.id))throw new Error(`内容包定义错误：${p.id||'unknown'}`);ids.add(p.id);}); }
  function validatePack(pack,def){
    const errors=[]; if(!pack||pack.schemaVersion!==3)errors.push('schemaVersion'); if(pack.packId!==def.id)errors.push('packId'); if(pack.packType!==def.type)errors.push('packType'); if(!Array.isArray(pack.items))errors.push('items'); if(pack.items?.length!==def.itemCount)errors.push(`itemCount ${pack.items?.length}/${def.itemCount}`);
    const ids=new Set(); for(const item of pack.items||[]){if(!item.id)errors.push('item.id'); else if(ids.has(item.id))errors.push(`duplicate ${item.id}`); ids.add(item.id);}
    if(errors.length)throw new Error(`${def.id} 校验失败：${errors.join(', ')}`); return true;
  }
  async function loadPack(id,force=false){
    if(app.packs.has(id)&&!force)return app.packs.get(id);
    const def=app.catalog.packs.find(p=>p.id===id); if(!def)throw new Error(`未找到内容包：${id}`);
    const pack=await fetchJson(def.path,force); validatePack(pack,def); app.packs.set(id,pack); indexPack(pack); return pack;
  }
  function indexPack(pack){
    if(pack.packType==='kanji')pack.items.forEach(x=>app.groups.set(x.id,x));
    if(pack.packType==='vocabulary')pack.items.forEach(x=>app.words.set(x.id,x));
    if(pack.packType==='dialogue')pack.items.forEach(x=>app.dialogues.set(x.id,x));
    if(pack.packType==='grammar')pack.items.forEach(x=>app.expressions.set(x.id,x));
    if(pack.packType==='mistake')pack.items.forEach(x=>app.mistakes.set(x.id,x));
  }
  async function ensureForRoute(route){
    if(route==='home') await Promise.all([loadPack('kanji-core'),loadPack('dialogues-business-it')]);
    if(route==='vocab'||route==='review') await Promise.all([loadPack('kanji-core'),loadPack('vocabulary-general'),loadPack('vocabulary-business-it')]);
    if(route==='dialogue') await Promise.all([loadPack('dialogues-daily'),loadPack('dialogues-business-it')]);
    if(route==='drill') await Promise.all([loadPack('business-expression-comparisons'),loadPack('common-business-mistakes')]);
  }
  async function runFullValidation(){
    const report={ok:true,checkedAt:new Date().toISOString(),errors:[],warnings:[],counts:{}};
    try{
      for(const def of app.catalog.packs) await loadPack(def.id,true);
      const globalIds=new Set(); for(const p of app.packs.values())for(const i of p.items){if(globalIds.has(i.id))report.errors.push(`全局重复ID: ${i.id}`);globalIds.add(i.id);}
      for(const g of app.groups.values())for(const wid of g.wordIds||[])if(!app.words.has(wid))report.errors.push(`汉字 ${g.kanji} 引用了不存在词汇 ${wid}`);
      const sentenceText=new Map(); for(const w of app.words.values()){if(!w.word||!w.reading)report.errors.push(`词汇必填字段缺失 ${w.id}`);for(const s of w.sentences||[]){if(sentenceText.has(s.jp))report.warnings.push(`重复例句：${s.jp}`);sentenceText.set(s.jp,s.id);}}
      report.counts={groups:app.groups.size,words:app.words.size,sentences:[...app.words.values()].reduce((n,w)=>n+(w.sentences?.length||0),0),dialogues:app.dialogues.size,lines:[...app.dialogues.values()].reduce((n,d)=>n+(d.lines?.length||0),0)};
    }catch(e){report.errors.push(e.message);} report.ok=report.errors.length===0; app.validation=report; return report;
  }

  function wordArray(){return [...app.words.values()];}
  function groupArray(){return [...app.groups.values()];}
  function dialogueArray(){return [...app.dialogues.values()];}
  function getProgress(id){return app.state.wordProgress[id]||{repetitions:0,nextReview:null,favorite:false,lastGrade:null,reviews:0};}
  function isDue(w){const p=getProgress(w.id);return !p.nextReview||new Date(p.nextReview).getTime()<=Date.now();}
  function dueWords(){return wordArray().filter(isDue);}
  function learnedCount(){return Object.values(app.state.wordProgress).filter(p=>p.repetitions>0).length;}
  function favoriteCount(){return Object.values(app.state.wordProgress).filter(p=>p.favorite).length;}
  function streakCount(){const dates=new Set(app.state.activityDates);let c=0,d=new Date();for(let i=0;i<365;i++){const k=d.toISOString().slice(0,10);if(!dates.has(k))break;c++;d.setDate(d.getDate()-1);}return c;}
  async function markActivity(){const today=new Date().toISOString().slice(0,10);if(!app.state.activityDates.includes(today)){app.state.activityDates.push(today);app.state.activityDates=app.state.activityDates.slice(-366);}await saveState();}

  async function navigate(route,detailId=null){app.route=route;app.detailId=detailId;app.reviewRevealed=false;title.textContent=titles[route]||'日语随身学';document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.route===route));main.innerHTML='<div class="loading-card">正在加载内容包…</div>';try{await ensureForRoute(route);render();window.scrollTo({top:0,behavior:'smooth'});}catch(e){main.innerHTML=emptyState('加载失败',e.message);}}
  function render(){if(app.detailId&&app.route==='vocab')return renderVocabDetail(app.detailId);if(app.detailId&&app.route==='dialogue')return renderDialogueDetail(app.detailId);({home:renderHome,vocab:renderVocab,dialogue:renderDialogues,drill:renderDrill,review:renderReview,settings:renderSettings}[app.route]||renderHome)();}
  function greeting(){const h=new Date().getHours();return h<11?'早上好':h<18?'下午好':'晚上好';}
  function statCard(v,l){return `<div class="stat-card"><strong>${v}</strong><span>${l}</span></div>`;}
  function emptyState(h,b){return `<div class="empty"><strong>${escapeHtml(h)}</strong>${escapeHtml(b)}</div>`;}

  function renderHome(){
    const groups=groupArray().slice(0,3),work=dialogueArray().slice(0,2),counts=app.catalog.counts;
    main.innerHTML=`<section class="hero"><h2>${greeting()}，今天也学一点。</h2><p>保留日常与 JLPT 基础，重点强化商务和 IT 工作表达。</p><div class="hero-actions"><button class="primary-button" data-action="start-review">开始今日复习</button><button class="secondary-button" data-route-link="dialogue">练习商务 / IT 对话</button><button class="secondary-button" data-route-link="drill">商务表达与纠错</button></div></section>
    <div class="stats-grid">${statCard(Object.keys(app.state.wordProgress).filter(id=>app.state.wordProgress[id].nextReview&&new Date(app.state.wordProgress[id].nextReview)<=new Date()).length,'已到期复习')}${statCard(learnedCount(),'已学习单词')}${statCard(favoriteCount(),'收藏')}${statCard(streakCount(),'连续学习天数')}</div>
    <section class="section"><div class="section-heading"><h2>内容基础</h2><p>第零阶段已分包</p></div><div class="card version-grid"><strong>汉字组</strong><span>${counts.kanjiGroups}</span><strong>唯一词汇</strong><span>${counts.uniqueVocabulary}</span><strong>例句</strong><span>${counts.sentences}</span><strong>对话场景</strong><span>${counts.dialogues}</span><strong>表达对比</strong><span>${app.catalog.supplementCounts?.expressionComparisons||0}</span><strong>常见错误</strong><span>${app.catalog.supplementCounts?.commonMistakes||0}</span></div></section>
    <section class="section"><div class="section-heading"><h2>推荐汉字</h2><button class="link-button" data-route-link="vocab">查看全部</button></div><div class="card-grid">${groups.map(kanjiCard).join('')}</div></section>
    <section class="section"><div class="section-heading"><h2>商务与 IT 场景</h2><p>按需加载</p></div><div class="card-grid two">${work.map(dialogueSummaryCard).join('')}</div></section>`;
  }
  function kanjiCard(g){const linked=(g.wordIds||[]).map(id=>app.words.get(id)).filter(Boolean);const kun=linked.filter(w=>w.kanjiLinks?.some(l=>l.kanjiGroupId===g.id&&l.readingType==='kun')).slice(0,2).map(w=>w.word).join('・')||'加载词汇后显示';const on=linked.filter(w=>w.kanjiLinks?.some(l=>l.kanjiGroupId===g.id&&l.readingType==='on')).slice(0,2).map(w=>w.word).join('・')||'加载词汇后显示';return `<button class="card kanji-card" data-vocab-detail="${g.id}" type="button"><span class="kanji-glyph">${escapeHtml(g.kanji)}</span><span style="text-align:left"><strong>${escapeHtml(g.meaningsZh.join('、'))}</strong><small style="display:block;color:var(--muted);margin-top:6px">训：${escapeHtml(kun)}<br>音：${escapeHtml(on)}</small></span><span class="chevron">›</span></button>`;}

  function renderVocab(){const q=app.search.trim().toLowerCase();const filtered=groupArray().filter(g=>{const ws=(g.wordIds||[]).map(id=>app.words.get(id)).filter(Boolean);const text=[g.kanji,g.meaningsZh.join(' '),...ws.flatMap(w=>[w.word,w.reading,...w.meaningsZh,...w.tags])].join(' ').toLowerCase();const mf=app.vocabFilter==='all'||ws.some(w=>w.tags.some(t=>t.toLowerCase()===app.vocabFilter.toLowerCase()));return (!q||text.includes(q))&&mf;});main.innerHTML=`<div class="search-row"><input id="vocab-search" class="search-input" value="${escapeHtml(app.search)}" placeholder="搜索汉字、单词、读音或标签"/><button class="ghost-button" data-action="clear-search">清除</button></div><div class="filter-pills">${[['all','全部'],['基础','基础'],['JLPT','JLPT'],['日常','日常'],['职场','职场'],['工作','商务'],['IT','IT'],['Git','Git'],['CI/CD','CI/CD'],['AWS','AWS']].map(([v,l])=>`<button class="pill ${app.vocabFilter===v?'active':''}" data-vocab-filter="${v}">${l}</button>`).join('')}</div><div class="card-grid">${filtered.length?filtered.map(kanjiCard).join(''):emptyState('没有匹配内容','换一个关键词试试。')}</div>`;}
  function renderVocabDetail(id){const g=app.groups.get(id);if(!g)return navigate('vocab');const ws=(g.wordIds||[]).map(x=>app.words.get(x)).filter(Boolean);const kun=ws.filter(w=>w.kanjiLinks.some(l=>l.kanjiGroupId===id&&l.readingType==='kun')),on=ws.filter(w=>w.kanjiLinks.some(l=>l.kanjiGroupId===id&&l.readingType==='on'));main.innerHTML=`<button class="ghost-button" data-action="back-vocab">← 返回单词列表</button><section class="card" style="margin-top:12px"><div class="detail-header"><div class="detail-kanji">${escapeHtml(g.kanji)}</div><div><p class="eyebrow">KANJI GROUP</p><h2>${escapeHtml(g.meaningsZh.join('・'))}</h2><p>${escapeHtml(g.jlptLevel)}</p></div></div></section>${readingBlock('训读词','訓読み',kun)}${readingBlock('音读词','音読み',on)}`;}
  function readingBlock(c,j,ws){return `<section class="reading-section"><div class="reading-title"><strong>${c}</strong><span class="tag">${j}</span></div>${ws.map(vocabItem).join('')||emptyState('暂无内容','后续内容包可继续扩充。')}</section>`;}
  function vocabItem(w){const p=getProgress(w.id);return `<article class="vocab-item"><div class="vocab-word"><strong>${escapeHtml(w.word)}</strong><span>${escapeHtml(w.reading)}</span><span class="tag">${escapeHtml(w.meaningsZh.join('、'))}</span></div><div class="tag-row">${w.tags.map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>${w.sentences.map((s,i)=>`<div class="sentence-box"><div class="sentence-jp"><span class="sentence-number">例${i+1}</span>${escapeHtml(s.jp)}</div>${app.state.settings.showReading?`<div class="sentence-reading">${escapeHtml(s.reading)}</div>`:''}${app.state.settings.showChinese?`<div class="sentence-zh">${escapeHtml(s.zh)}</div>`:''}<div class="inline-actions"><button class="mini-button" data-speak="${escapeHtml(s.jp)}">🔊 例句</button><button class="mini-button" data-speak-slow="${escapeHtml(s.jp)}">🐢 慢速</button></div></div>`).join('')}<div class="inline-actions"><button class="mini-button" data-speak="${escapeHtml(w.word)}">🔊 单词</button><button class="mini-button favorite ${p.favorite?'active':''}" data-favorite="${w.id}">${p.favorite?'★ 已收藏':'☆ 收藏'}</button></div></article>`;}

  function renderDialogues(){const ds=dialogueArray().filter(d=>app.dialogueFilter==='all'||(app.dialogueFilter==='daily'?d.category==='daily':d.category!=='daily'));main.innerHTML=`<div class="filter-pills"><button class="pill ${app.dialogueFilter==='all'?'active':''}" data-dialogue-filter="all">全部</button><button class="pill ${app.dialogueFilter==='daily'?'active':''}" data-dialogue-filter="daily">日常生活</button><button class="pill ${app.dialogueFilter==='business'?'active':''}" data-dialogue-filter="business">商务 / IT / 职场</button></div><div class="card-grid two">${ds.map(dialogueSummaryCard).join('')}</div>`;}
  function dialogueSummaryCard(d){const done=app.state.dialogueProgress[d.id]?.completed;return `<button class="card dialogue-card" data-dialogue-detail="${d.id}" type="button" style="text-align:left"><div class="dialogue-meta"><span>${d.category==='daily'?'日常生活':(d.category==='workplace'?'职场基础':'商务 / IT')}</span><span>${escapeHtml(d.jlptLevel)}</span></div><h3 style="margin-top:10px">${escapeHtml(d.title)} ${done?'✓':''}</h3><p>${escapeHtml(d.situation)}</p><div class="tag-row">${d.keywordTexts.slice(0,3).map(x=>`<span class="tag">${escapeHtml(x)}</span>`).join('')}</div></button>`;}
  function renderDialogueDetail(id){const d=app.dialogues.get(id);if(!d)return navigate('dialogue');main.innerHTML=`<button class="ghost-button" data-action="back-dialogue">← 返回对话列表</button><section class="card" style="margin-top:12px"><p class="eyebrow">${d.category==='daily'?'DAILY LIFE':'BUSINESS / IT'}</p><h2>${escapeHtml(d.title)}</h2><p>${escapeHtml(d.situation)}</p><div class="inline-actions"><button class="primary-button" data-speak="${escapeHtml(d.lines.map(l=>l.jp).join('。'))}">▶ 播放完整对话</button><button class="ghost-button" data-dialogue-complete="${d.id}">标记已练习</button></div></section><section class="card dialogue-lines">${d.lines.map((l,i)=>`<div class="dialogue-line"><div class="speaker">${escapeHtml(l.speaker)}</div><div><div class="line-jp">${escapeHtml(l.jp)}</div>${app.state.settings.showChinese&&l.zh?`<div class="line-zh">${escapeHtml(l.zh)}</div>`:''}<button class="mini-button" data-speak="${escapeHtml(l.jp)}">🔊 第${i+1}句</button></div></div>`).join('')}</section><section class="section"><div class="section-heading"><h2>重点表达</h2></div><div class="card"><div class="tag-row">${d.keywordTexts.map(x=>`<span class="tag">${escapeHtml(x)}</span>`).join('')}</div></div></section>${d.learningPoints.length?`<section class="section"><div class="section-heading"><h2>学习要点</h2></div><div class="card learning-points">${d.learningPoints.map((x,i)=>`<p><strong>${i+1}.</strong> ${escapeHtml(x)}</p>`).join('')}</div></section>`:''}${d.expressions.length?`<section class="section"><div class="section-heading"><h2>可替换表达</h2></div><div class="card expression-list">${d.expressions.map(e=>`<div class="expression-item"><span class="tag">${escapeHtml(e.label)}</span><div class="line-jp">${escapeHtml(e.jp)}</div>${app.state.settings.showChinese?`<div class="line-zh">${escapeHtml(e.zh)}</div>`:''}<button class="mini-button" data-speak="${escapeHtml(e.jp)}">🔊 播放</button></div>`).join('')}</div></section>`:''}`;}

  function prepareReviewQueue(){const due=dueWords();app.reviewQueue=(due.length?due:wordArray()).sort(()=>Math.random()-.5).slice(0,20);app.reviewIndex=0;app.reviewRevealed=false;}
  function renderDrill(){
    const mode=app.drillMode;
    const buttons=`<div class="filter-pills"><button class="pill ${mode==='expression'?'active':''}" data-drill-mode="expression">表达层级对比</button><button class="pill ${mode==='mistake'?'active':''}" data-drill-mode="mistake">常见错误</button></div>`;
    if(mode==='expression'){
      const items=[...app.expressions.values()];
      main.innerHTML=buttons+`<div class="card-grid two">${items.map(x=>`<article class="card"><p class="eyebrow">${escapeHtml(x.category)}</p><h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(x.descriptionZh||'')}</p>${(x.variants||[]).map(v=>`<div class="expression-item"><span class="tag">${escapeHtml(v.label)}</span><div class="line-jp">${escapeHtml(v.jp)}</div><button class="mini-button" data-speak="${escapeHtml(v.jp)}">🔊 播放</button></div>`).join('')}<p class="muted-note">${escapeHtml(x.notesZh||'')}</p></article>`).join('')}</div>`;
    }else{
      const items=[...app.mistakes.values()];
      main.innerHTML=buttons+`<div class="card-grid two">${items.map(x=>`<article class="card"><p class="eyebrow">${escapeHtml(x.category)}</p><div class="mistake-wrong">✕ ${escapeHtml(x.wrong)}</div><div class="mistake-correct">✓ ${escapeHtml(x.correct)}</div><p>${escapeHtml(x.explanationZh)}</p><button class="mini-button" data-speak="${escapeHtml(x.correct)}">🔊 正确表达</button></article>`).join('')}</div>`;
    }
  }

  function renderReview(){if(!app.reviewQueue.length||app.reviewIndex>=app.reviewQueue.length){if(app.reviewQueue.length&&app.reviewIndex>=app.reviewQueue.length){main.innerHTML=`<section class="card review-card"><div class="review-kanji">✓</div><h2>本轮完成</h2><p>学习记录已写入 IndexedDB，并保留本地快照。</p><button class="primary-button" data-action="restart-review">再练一轮</button></section>`;return;}prepareReviewQueue();}const w=app.reviewQueue[app.reviewIndex];if(!w){main.innerHTML=emptyState('暂无复习内容','教材包未加载或暂无词汇。');return;}const s=w.sentences[0]||{jp:w.word,reading:w.reading,zh:w.meaningsZh.join('、')};const percent=Math.round(app.reviewIndex/app.reviewQueue.length*100);main.innerHTML=`<div class="progress"><span style="width:${percent}%"></span></div><p style="text-align:center;color:var(--muted)">${app.reviewIndex+1} / ${app.reviewQueue.length}</p><section class="card review-card"><div class="review-question">${app.reviewRevealed?escapeHtml(w.word):'这个词怎么读？'}</div><div class="sentence-box"><div class="sentence-jp">${escapeHtml(s.jp.replace(w.word,'＿＿＿'))}</div></div>${app.reviewRevealed?`<div class="review-answer"><h3>${escapeHtml(w.word)}（${escapeHtml(w.reading)}）</h3><p>${escapeHtml(w.meaningsZh.join('、'))}</p><div class="sentence-box"><div class="sentence-jp">${escapeHtml(s.jp)}</div>${app.state.settings.showReading?`<div class="sentence-reading">${escapeHtml(s.reading)}</div>`:''}${app.state.settings.showChinese?`<div class="sentence-zh">${escapeHtml(s.zh)}</div>`:''}</div><div class="grade-grid"><button class="grade-button again" data-grade="again">完全不会</button><button class="grade-button hard" data-grade="hard">有点模糊</button><button class="grade-button good" data-grade="good">基本记住</button><button class="grade-button easy" data-grade="easy">很熟练</button></div></div>`:`<button class="primary-button" data-action="reveal-answer">显示答案</button>`}</section>`;}
  async function gradeWord(grade){const w=app.reviewQueue[app.reviewIndex],old=getProgress(w.id),intervals={again:0,hard:1,good:Math.max(3,old.repetitions*3),easy:Math.max(7,old.repetitions*5)},next=new Date(Date.now()+intervals[grade]*DAY);if(grade==='again')next.setMinutes(next.getMinutes()+20);app.state.wordProgress[w.id]={...old,repetitions:grade==='again'?0:old.repetitions+1,reviews:(old.reviews||0)+1,lastGrade:grade,lastReviewed:new Date().toISOString(),nextReview:next.toISOString()};await markActivity();app.reviewIndex++;app.reviewRevealed=false;renderReview();}

  async function snapshotsHtml(){const xs=(await idbAll('snapshots')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return xs.length?xs.map(x=>`<div class="backup-item"><span><strong>${escapeHtml(x.reason)}</strong><small>${new Date(x.createdAt).toLocaleString()}</small></span><button class="mini-button" data-restore-snapshot="${x.id}">恢复</button></div>`).join(''):'<p>暂无本地快照。</p>';}
  async function renderSettings(){const s=app.state.settings,backups=await snapshotsHtml();main.innerHTML=`<section class="card">${settingToggle('显示假名','在例句下显示平假名读音','showReading',s.showReading)}${settingToggle('显示中文','显示例句和对话中文','showChinese',s.showChinese)}${settingToggle('深色模式','适合夜间学习','dark',s.dark)}<div class="setting-row"><div><strong>朗读速度</strong><small>当前 ${s.speechRate} 倍</small></div><select id="speech-rate" class="select-input" style="width:120px"><option value="0.7" ${s.speechRate==0.7?'selected':''}>慢速</option><option value="0.9" ${s.speechRate==0.9?'selected':''}>标准</option><option value="1.1" ${s.speechRate==1.1?'selected':''}>快速</option></select></div></section>
    <section class="section"><div class="section-heading"><h2>版本与更新</h2></div><div class="card version-grid"><strong>App</strong><span>${APP_VERSION}</span><strong>内容</strong><span>${escapeHtml(app.catalog.contentVersion)}</span><strong>数据结构</strong><span>v${STATE_SCHEMA_VERSION}</span><strong>已加载内容包</strong><span>${app.packs.size}/${app.catalog.packs.length}</span></div><div class="inline-actions"><button class="ghost-button" data-action="check-update">检查更新</button><button class="ghost-button" data-action="reload-content">重新加载教材</button><button class="ghost-button" data-action="validate-content">完整校验</button></div></section>
    <section class="section"><div class="section-heading"><h2>数据管理</h2></div><div class="card"><div class="inline-actions"><button class="ghost-button" data-action="export-data">导出学习记录</button><button class="ghost-button" data-action="import-data">导入学习记录</button><button class="ghost-button" data-action="create-snapshot">创建本地快照</button><button class="ghost-button" data-action="reset-data">清空学习记录</button></div></div></section>
    <section class="section"><div class="section-heading"><h2>本地快照</h2></div><div class="card backup-list">${backups}</div></section>
    <section class="section"><div class="section-heading"><h2>内容包</h2></div><div class="card">${app.catalog.packs.map(p=>`<div class="pack-row"><span><strong>${escapeHtml(p.title)}</strong><small>${p.type} · ${p.itemCount} 项 · ${p.lazy?'按需加载':'基础加载'}</small></span><span>${app.packs.has(p.id)?'已加载':'未加载'}</span></div>`).join('')}</div></section>`;}
  function settingToggle(t,d,k,a){return `<div class="setting-row"><div><strong>${t}</strong><small>${d}</small></div><button class="switch ${a?'active':''}" data-setting-toggle="${k}"><span></span></button></div>`;}

  function speak(text,slow=false){if(!('speechSynthesis'in window))return showToast('当前浏览器不支持语音朗读');speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='ja-JP';u.rate=slow?0.65:Number(app.state.settings.speechRate||.9);const vs=speechSynthesis.getVoices();u.voice=vs.find(v=>v.lang==='ja-JP')||vs.find(v=>v.lang.startsWith('ja'))||null;speechSynthesis.speak(u);}
  async function toggleFavorite(id){const p=getProgress(id);app.state.wordProgress[id]={...p,favorite:!p.favorite};await markActivity();render();}
  async function exportData(){await ensureDailySnapshot('export');const payload={app:'nihongo-lab',formatVersion:3,appVersion:APP_VERSION,contentVersion:app.catalog.contentVersion,exportedAt:new Date().toISOString(),state:app.state};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`nihongo-lab-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);showToast('备份文件已导出');}
  async function importData(file){const obj=safeParse(await file.text());if(!obj||obj.app!=='nihongo-lab'||!obj.state)throw new Error('不是有效的学习记录备份');await ensureDailySnapshot('before-import');app.state=await migrateState(obj.state,'import');await saveState(false);applyTheme();render();showToast('学习记录已导入');}
  async function restoreSnapshot(id){const x=await idbGet('snapshots',id);if(!x)return;await ensureDailySnapshot('before-restore');app.state=await migrateState(x.state,'snapshot');await saveState(false);applyTheme();await renderSettings();showToast('已恢复本地快照');}
  function applyTheme(){document.body.classList.toggle('dark',!!app.state.settings.dark);}
  function showUpdate(message,worker=null){app.waitingWorker=worker;updateMessage.textContent=message;updateBanner.hidden=false;}
  async function checkUpdate(){try{app.registration&&await app.registration.update();const fresh=await fetchJson('./data/catalog.json',true);if(fresh.contentVersion!==app.catalog.contentVersion||compareVersions(fresh.appVersion,APP_VERSION)>0)showUpdate(`检测到新内容 ${fresh.contentVersion}，建议更新。`);else showToast('当前已经是最新版本');}catch(e){showToast(`检查失败：${e.message}`);}}

  document.addEventListener('click',async e=>{
    const t=e.target.closest('button');if(!t)return;
    if(t.dataset.route)return navigate(t.dataset.route);
    if(t.dataset.routeLink)return navigate(t.dataset.routeLink);
    if(t.dataset.vocabDetail)return navigate('vocab',t.dataset.vocabDetail);
    if(t.dataset.dialogueDetail)return navigate('dialogue',t.dataset.dialogueDetail);
    if(t.dataset.vocabFilter!==undefined){app.vocabFilter=t.dataset.vocabFilter;renderVocab();return;}
    if(t.dataset.dialogueFilter!==undefined){app.dialogueFilter=t.dataset.dialogueFilter;renderDialogues();return;}
    if(t.dataset.drillMode!==undefined){app.drillMode=t.dataset.drillMode;renderDrill();return;}
    if(t.dataset.speak!==undefined)return speak(t.dataset.speak,false);
    if(t.dataset.speakSlow!==undefined)return speak(t.dataset.speakSlow,true);
    if(t.dataset.favorite)return toggleFavorite(t.dataset.favorite);
    if(t.dataset.grade)return gradeWord(t.dataset.grade);
    if(t.dataset.dialogueComplete){app.state.dialogueProgress[t.dataset.dialogueComplete]={completed:true,completedAt:new Date().toISOString()};await markActivity();render();return;}
    if(t.dataset.settingToggle){const k=t.dataset.settingToggle;app.state.settings[k]=!app.state.settings[k];await saveState();applyTheme();await renderSettings();return;}
    if(t.dataset.restoreSnapshot)return restoreSnapshot(t.dataset.restoreSnapshot);
    const a=t.dataset.action;
    if(a==='start-review')return navigate('review'); if(a==='back-vocab')return navigate('vocab'); if(a==='back-dialogue')return navigate('dialogue'); if(a==='clear-search'){app.search='';renderVocab();return;} if(a==='reveal-answer'){app.reviewRevealed=true;renderReview();return;} if(a==='restart-review'){app.reviewQueue=[];renderReview();return;}
    if(a==='export-data')return exportData(); if(a==='import-data')return importFile.click();
    if(a==='create-snapshot'){await ensureDailySnapshot(`manual-${Date.now()}`);await renderSettings();showToast('已创建本地快照');return;}
    if(a==='reset-data'){if(confirm('确定清空学习记录吗？操作前会自动创建快照。')){await ensureDailySnapshot('before-reset');app.state=defaultState();await saveState(false);applyTheme();await renderSettings();showToast('学习记录已清空');}return;}
    if(a==='check-update')return checkUpdate();
    if(a==='reload-content'){app.packs.clear();app.groups.clear();app.words.clear();app.dialogues.clear();app.expressions.clear();app.mistakes.clear();await loadCatalog(true);await ensureForRoute(app.route);render();showToast('教材已重新加载');return;}
    if(a==='validate-content'){main.innerHTML='<div class="loading-card">正在加载并校验全部内容包…</div>';const r=await runFullValidation();await renderSettings();const box=document.createElement('section');box.className=`card ${r.ok?'validation-ok':'validation-error'}`;box.innerHTML=`<strong>${r.ok?'校验通过':'发现错误'}</strong><p>${r.ok?`共检查 ${r.counts.words} 个唯一词汇、${r.counts.sentences} 条例句、${r.counts.dialogues} 个对话。`:escapeHtml(r.errors.join('；'))}</p>${r.warnings.length?`<p>警告：${escapeHtml(r.warnings.slice(0,5).join('；'))}</p>`:''}`;main.prepend(box);return;}
  });
  document.addEventListener('input',e=>{if(e.target.id==='vocab-search'){app.search=e.target.value;renderVocab();}});
  document.addEventListener('change',async e=>{if(e.target.id==='speech-rate'){app.state.settings.speechRate=Number(e.target.value);await saveState();}if(e.target===importFile&&e.target.files[0]){try{await importData(e.target.files[0]);}catch(err){showToast(err.message);}e.target.value='';}});
  document.getElementById('theme-toggle').addEventListener('click',async()=>{app.state.settings.dark=!app.state.settings.dark;await saveState();applyTheme();render();});
  document.getElementById('apply-update').addEventListener('click',()=>{if(app.waitingWorker)app.waitingWorker.postMessage({type:'SKIP_WAITING'});else location.reload();});
  document.getElementById('dismiss-update').addEventListener('click',()=>updateBanner.hidden=true);

  async function registerSW(){if(!('serviceWorker'in navigator))return;app.registration=await navigator.serviceWorker.register('./service-worker.js');if(app.registration.waiting)showUpdate('新版本已准备好。',app.registration.waiting);app.registration.addEventListener('updatefound',()=>{const w=app.registration.installing;w?.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)showUpdate('检测到程序更新。',w);});});navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload());}

  async function init(){
    try{app.db=await openDb();await loadCatalog(false);app.state=await loadState();applyTheme();await ensureDailySnapshot('startup');await registerSW();if(app.state.lastContentVersion&&app.state.lastContentVersion!==app.catalog.contentVersion)showUpdate(`教材已从 ${app.state.lastContentVersion} 更新到 ${app.catalog.contentVersion}。`);app.state.lastContentVersion=app.catalog.contentVersion;app.state.lastAppVersion=APP_VERSION;await saveState(false);await navigate('home');}
    catch(e){console.error(e);main.innerHTML=emptyState('启动失败',`${e.message}。请确认通过 HTTPS 部署，并检查文件是否完整。`);}
  }
  init();
})();
