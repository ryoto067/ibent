(function () {
  'use strict';

  const CFG = window.TORUZO_CONFIG;
  const TEAM_NOS = Object.keys(CFG.teamRoutes).map(Number).sort((a, b) => a - b);
  const STORE_KEY = 'toruzo-team';
  const BUCKET = 'photos';

  const $ = (id) => document.getElementById(id);

  // ─────────────────────────────────────────────
  // データの保存先（本番：Supabase ／ デモ：この端末のメモリ）
  // ─────────────────────────────────────────────
  // チームの回る順番から、スポットと目安時刻を計算する
  function planFor(no) {
    const start = new Date(CFG.startTime).getTime();
    let t = 0, pos = 0;
    const steps = CFG.teamRoutes[no].map(([mid, key], i) => {
      const spot = CFG.spots[key];
      t += Math.abs(spot.pos - pos);
      pos = spot.pos;
      const step = { mid: mid, order: i + 1, spot: spot, at: new Date(start + t * 60000) };
      t += CFG.minutesPerMission;
      return step;
    });
    const back = new Date(start + (t + pos) * 60000);
    return { steps: steps, back: back };
  }
  function hhmm(d) {
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
  }

  function buildMissions(no, photos) {
    return planFor(no).steps.map((st) => Object.assign(
      { id: st.mid, order: st.order, spot: st.spot.name, at: hhmm(st.at), photos: photos.filter((p) => p.mission === st.mid) },
      CFG.missions[st.mid]
    ));
  }

  function supabaseApi() {
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
    const pub = (path) => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

    return {
      async getTeams() {
        return check(await sb.from('teams').select('no,name').order('no'));
      },
      async getTeam(no) {
        const [t, ps] = await Promise.all([
          sb.from('teams').select('no,name,best_photo_id').eq('no', no).maybeSingle(),
          sb.from('photos').select('id,mission,path,thumb_path,created_at').eq('team', no).order('created_at'),
        ]);
        const row = check(t);
        if (!row) throw new Error('チーム' + no + 'はまだ登録されていません（supabase.sql の teams を確認）');
        const photos = check(ps).map((p) => ({
          id: p.id, mission: p.mission, path: p.path, thumbPath: p.thumb_path,
          thumb: pub(p.thumb_path), large: pub(p.path),
        }));
        return { no: row.no, name: row.name || '', best: row.best_photo_id || '', missions: buildMissions(no, photos) };
      },
      async setName(no, name) {
        check(await sb.from('teams').update({ name: name, updated_at: new Date().toISOString() }).eq('no', no));
      },
      async upload(no, mission, large, thumb) {
        const base = 'team-' + no + '/m' + mission + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const opts = { contentType: 'image/jpeg', upsert: false };
        check(await sb.storage.from(BUCKET).upload(base + '.jpg', large, opts));
        check(await sb.storage.from(BUCKET).upload(base + '_t.jpg', thumb, opts));
        check(await sb.from('photos').insert({ team: no, mission: mission, path: base + '.jpg', thumb_path: base + '_t.jpg' }));
      },
      async setBest(no, photoId) {
        check(await sb.from('teams').update({ best_photo_id: photoId || null }).eq('no', no));
      },
      async deletePhoto(no, photo, wasBest) {
        if (wasBest) check(await sb.from('teams').update({ best_photo_id: null }).eq('no', no));
        check(await sb.from('photos').delete().eq('id', photo.id).eq('team', no));
        await sb.storage.from(BUCKET).remove([photo.path, photo.thumbPath]);
      },
      subscribe(no, onChange) {
        const ch = sb.channel('team-' + no)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'photos' }, onChange)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: 'no=eq.' + no }, onChange)
          .subscribe();
        return () => sb.removeChannel(ch);
      },
    };
  }

  function demoApi() {
    const teams = {};
    TEAM_NOS.forEach((n) => { teams[n] = { name: '', best: '', photos: [] }; });
    const wait = (v) => new Promise((r) => setTimeout(() => r(v), 150));
    return {
      async getTeams() { return wait(TEAM_NOS.map((n) => ({ no: n, name: teams[n].name }))); },
      async getTeam(no) {
        const t = teams[no];
        if (!t) throw new Error('チーム番号が正しくありません');
        return wait({ no: no, name: t.name, best: t.best, missions: buildMissions(no, t.photos) });
      },
      async setName(no, name) { teams[no].name = name; return wait(); },
      async upload(no, mission, large, thumb) {
        teams[no].photos.push({ id: 'p' + Date.now() + Math.random(), mission: mission,
          thumb: URL.createObjectURL(thumb), large: URL.createObjectURL(large) });
        return wait();
      },
      async setBest(no, id) { teams[no].best = id || ''; return wait(); },
      async deletePhoto(no, photo) {
        teams[no].photos = teams[no].photos.filter((p) => p.id !== photo.id);
        if (teams[no].best === photo.id) teams[no].best = '';
        return wait();
      },
      subscribe() { return () => {}; },
    };
  }

  const isDemo = !(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
  const api = isDemo ? demoApi() : supabaseApi();
  if (isDemo) $('demo-bar').hidden = false;

  // ─────────────────────────────────────────────
  // 画面
  // ─────────────────────────────────────────────
  let teamsList = null;   // [{no, name}]
  let team = null;        // 表示中のチーム
  let pickedTeam = null;
  let uploadMission = null;
  const pending = {};     // missionId -> アップロード中の枚数
  let viewing = null;     // ビューアで開いている写真
  let unsubscribe = null;
  let pollTimer = null;

  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, isErr ? 4000 : 2200);
  }
  function errMsg(e) {
    const m = (e && e.message) ? String(e.message) : String(e || '');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return '通信できませんでした。電波の良い場所でもう一度試してください';
    return m || '通信に失敗しました。もう一度試してください';
  }
  function showLoadError(e) {
    $('load-error-text').textContent = '読み込めませんでした：' + errMsg(e);
    $('load-error').hidden = false;
  }

  function ask(title, text, yesLabel, danger) {
    return new Promise((resolve) => {
      $('confirm-title').textContent = title;
      $('confirm-text').textContent = text;
      const yes = $('confirm-yes');
      yes.textContent = yesLabel;
      yes.className = danger ? 'danger' : 'ok';
      $('confirm').hidden = false;
      const done = (v) => { $('confirm').hidden = true; yes.onclick = null; $('confirm-no').onclick = null; resolve(v); };
      yes.onclick = () => done(true);
      $('confirm-no').onclick = () => done(false);
    });
  }

  function saveTeam(no) { try { localStorage.setItem(STORE_KEY, String(no)); } catch (e) {} }
  function loadTeam() { try { return Number(localStorage.getItem(STORE_KEY)) || null; } catch (e) { return null; } }
  function clearTeam() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} }

  // ── チーム番号の入力画面 ──
  function parseTeamNo(v) {
    const half = String(v || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim();
    return /^\d+$/.test(half) ? Number(half) : null;
  }

  function renderStart() {
    const raw = $('team-no-input').value.trim();
    const no = parseTeamNo(raw);
    const valid = !!no && TEAM_NOS.indexOf(no) !== -1;
    pickedTeam = valid ? no : null;
    const t = (valid && teamsList) ? teamsList.find((x) => x.no === no) : null;
    const hint = $('team-hint');
    const range = TEAM_NOS[0] + '〜' + TEAM_NOS[TEAM_NOS.length - 1];
    if (!raw) { hint.className = 'hint'; hint.textContent = range + 'の番号を入力'; }
    else if (!valid) { hint.className = 'hint err'; hint.textContent = 'チーム番号は' + range + 'です'; }
    else { hint.className = 'hint ok'; hint.textContent = (t && t.name) ? 'チーム' + no + '「' + t.name + '」' : 'チーム' + no; }
    $('start-btn').disabled = !pickedTeam;
  }
  $('team-no-input').addEventListener('input', renderStart);
  $('team-no-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && pickedTeam) $('start-btn').click(); });

  function showStart() {
    stopLive();
    $('main').hidden = true;
    $('start').hidden = false;
    renderStart();
  }

  async function openTeam(no) {
    $('start-btn').disabled = true;
    $('start-btn').textContent = '読み込み中…';
    $('load-error').hidden = true;
    try {
      team = await api.getTeam(no);
      saveTeam(no);
      showMain();
    } catch (e) {
      showStart();
      showLoadError(e);
    } finally {
      $('start-btn').textContent = 'お題を見る';
      $('start-btn').disabled = !pickedTeam;
    }
  }
  $('start-btn').onclick = () => { if (pickedTeam) openTeam(pickedTeam); };
  $('retry-btn').onclick = () => init();

  // ── お題の画面 ──
  function showMain() {
    $('start').hidden = true;
    $('main').hidden = false;
    renderMain();
    startLive();
  }

  async function refresh() {
    if (!team) return;
    try { team = await api.getTeam(team.no); renderMain(); } catch (e) { /* 次の更新で再試行 */ }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function renderMain() {
    $('t-no').textContent = team.no;
    $('t-name').textContent = team.name || 'チーム名 未定';
    const card = $('name-card');
    const wasHidden = card.hidden;
    card.hidden = !!team.name;
    if (!team.name && wasHidden) $('team-name-input').value = '';

    const list = $('missions');
    list.textContent = '';
    let done = 0;
    let best = null;

    team.missions.forEach((m) => {
      const isDone = m.photos.length > 0;
      if (isDone) done++;
      const art = el('article', 'mission' + (isDone ? ' done' : ''));
      const head = el('div', 'm-head');
      const body = el('div', 'm-body');
      body.appendChild(el('span', 'tag', m.tag));
      if (isDone) body.appendChild(el('span', 'clear', 'クリア'));
      body.append(el('h2', 'm-title', m.title), el('p', 'm-desc', m.desc), el('div', 'm-spot', '📍 ' + m.spot + '　目安 ' + m.at));
      head.append(el('div', 'm-no', isDone ? '✓' : String(m.order)), body);

      const grid = el('div', 'photos');
      m.photos.forEach((p) => {
        const isBest = p.id === team.best;
        if (isBest) best = p;
        const b = el('button', 'photo' + (isBest ? ' best' : ''));
        b.setAttribute('aria-label', 'お題' + m.order + 'の写真を開く');
        const img = el('img');
        img.src = p.thumb;
        img.alt = '';
        img.loading = 'lazy';
        b.appendChild(img);
        if (isBest) b.appendChild(el('span', 'star', 'BEST'));
        b.onclick = () => openViewer(p);
        grid.appendChild(b);
      });
      for (let i = 0; i < (pending[m.id] || 0); i++) grid.appendChild(el('div', 'photo pending', '送信中…'));

      const add = el('button', 'add');
      add.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
      add.appendChild(document.createTextNode(isDone ? '写真を追加する' : '写真をアップロード'));
      add.onclick = () => { uploadMission = m.id; $('file-input').value = ''; $('file-input').click(); };

      art.append(head, grid, add);
      list.appendChild(art);
    });

    $('done-n').textContent = done;
    $('total-n').textContent = team.missions.length;
    $('done-bar').style.width = (done / team.missions.length * 100) + '%';
    $('best-box').hidden = !best;
    if (best) $('best-img').src = best.large;
    renderRoute();
  }

  // ── ルートの地図 ──
  let map = null, mapTeam = null, pinLayer = null, meMarker = null, watchId = null;
  const pinIcon = (label, cls) => L.divIcon({ className: '', html: '<div class="pin ' + cls + '">' + label + '</div>', iconSize: [30, 30], iconAnchor: [15, 15] });

  function renderRoute() {
    const plan = planFor(team.no);
    const doneIds = new Set(team.missions.filter((m) => m.photos.length).map((m) => m.id));

    // 順番の一覧
    const ol = $('route-steps');
    ol.textContent = '';
    const row = (time, num, cls, text) => {
      const li = el('li');
      li.append(el('span', 't', time), el('span', 'n ' + cls, num), el('span', '', text));
      ol.appendChild(li);
    };
    row(hhmm(new Date(CFG.startTime)), '集', 's', CFG.meetingPoint.name + 'を出発');
    plan.steps.forEach((st) => row(hhmm(st.at), String(st.order), doneIds.has(st.mid) ? 'ok' : '', st.spot.name + '：' + CFG.missions[st.mid].title));
    row(hhmm(plan.back), '集', 's', '集合場所に戻る（16:20 まで）');

    if (!window.L) { $('map').hidden = true; return; }
    if (!map) {
      map = L.map('map', { zoomControl: true, attributionControl: true, scrollWheelZoom: false, tap: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      L.polyline(window.TORUZO_ROUTE || [], { color: '#0B7488', weight: 6, opacity: 0.8 }).addTo(map);
      pinLayer = L.layerGroup().addTo(map);
    }
    pinLayer.clearLayers();
    const mp = CFG.meetingPoint;
    L.marker([mp.lat, mp.lng], { icon: pinIcon('集合', 'pin-start'), title: mp.name }).addTo(pinLayer);

    // 同じスポットのお題は1つのピンにまとめる
    const bySpot = new Map();
    plan.steps.forEach((st) => {
      const k = st.spot.name;
      if (!bySpot.has(k)) bySpot.set(k, { spot: st.spot, nums: [], done: true });
      const g = bySpot.get(k);
      g.nums.push(st.order);
      if (!doneIds.has(st.mid)) g.done = false;
    });
    bySpot.forEach((g) => {
      L.marker([g.spot.lat, g.spot.lng], { icon: pinIcon(g.nums.join('・'), g.done ? 'done' : ''), title: g.spot.name })
        .bindPopup(g.spot.name).addTo(pinLayer);
    });
    if (mapTeam !== team.no) {
      map.fitBounds(L.latLngBounds((window.TORUZO_ROUTE || []).concat([[mp.lat, mp.lng]])), { padding: [24, 24] });
      mapTeam = team.no;
    }
    setTimeout(() => map.invalidateSize(), 0);
  }

  $('locate-btn').onclick = () => {
    if (!navigator.geolocation || !map) { toast('この端末では現在地を表示できません', true); return; }
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
      $('locate-btn').textContent = '現在地を表示';
      return;
    }
    $('locate-btn').textContent = '現在地を探しています…';
    let first = true;
    watchId = navigator.geolocation.watchPosition((pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (!meMarker) meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 1000 }).addTo(map);
      else meMarker.setLatLng(ll);
      if (first) { map.panTo(ll); first = false; }
      $('locate-btn').textContent = '現在地を隠す';
    }, (err) => {
      toast(err.code === 1 ? '位置情報の利用が許可されていません。設定で許可してください' : '現在地を取得できませんでした', true);
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      $('locate-btn').textContent = '現在地を表示';
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  };

  // ── チーム名 ──
  async function saveName(name) {
    name = String(name || '').trim().slice(0, 30);
    if (!name) { toast('チーム名を入力してください', true); return false; }
    try {
      await api.setName(team.no, name);
      team.name = name;
      renderMain();
      toast('チーム名を「' + name + '」にしました');
      return true;
    } catch (e) { toast(errMsg(e), true); return false; }
  }
  $('team-name-save').onclick = async () => {
    $('team-name-save').disabled = true;
    await saveName($('team-name-input').value);
    $('team-name-save').disabled = false;
  };
  $('team-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('team-name-save').click(); });

  $('rename-btn').onclick = () => {
    $('confirm-title').textContent = 'チーム名を変更';
    const p = $('confirm-text');
    p.textContent = '';
    const input = el('input');
    input.type = 'text';
    input.id = 'rename-input';
    input.maxLength = 30;
    input.value = team.name || '';
    input.placeholder = 'チーム名';
    p.appendChild(input);
    const yes = $('confirm-yes');
    yes.textContent = '保存';
    yes.className = 'ok';
    $('confirm').hidden = false;
    setTimeout(() => input.focus(), 50);
    const close = () => { $('confirm').hidden = true; yes.onclick = null; $('confirm-no').onclick = null; };
    $('confirm-no').onclick = close;
    yes.onclick = async () => { if (await saveName(input.value)) close(); };
  };

  // ── 写真のアップロード（端末側で縮小してから送る） ──
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像は読み込めませんでした。別の写真を選んでください')); };
      img.src = url;
    });
  }
  function toJpeg(img, max, quality) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise((resolve, reject) => c.toBlob((b) => b ? resolve(b) : reject(new Error('画像の変換に失敗しました')), 'image/jpeg', quality));
  }

  $('file-input').addEventListener('change', async (ev) => {
    const files = Array.from(ev.target.files || []);
    const mid = uploadMission;
    if (!files.length || !mid || !team) return;
    const no = team.no;
    pending[mid] = (pending[mid] || 0) + files.length;
    renderMain();
    let ok = 0;
    for (const f of files) {
      try {
        const img = await loadImage(f);
        const [large, thumb] = await Promise.all([toJpeg(img, 1600, 0.85), toJpeg(img, 480, 0.8)]);
        await api.upload(no, mid, large, thumb);
        ok++;
      } catch (e) {
        toast(errMsg(e), true);
      }
      pending[mid]--;
      await refresh();
    }
    if (ok) toast(ok + '枚アップロードしました');
  });

  // ── 写真ビューア ──
  function openViewer(p) {
    viewing = p;
    $('viewer-img').src = p.large;
    $('viewer-best').textContent = (p.id === team.best) ? 'ベストショットを解除' : 'ベストショットに選ぶ';
    $('viewer').hidden = false;
  }
  function closeViewer() { $('viewer').hidden = true; viewing = null; }
  $('viewer-close').onclick = closeViewer;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('viewer').hidden) closeViewer(); });

  $('viewer-best').onclick = async () => {
    const p = viewing;
    const makeBest = p.id !== team.best;
    try {
      await api.setBest(team.no, makeBest ? p.id : null);
      closeViewer();
      await refresh();
      toast(makeBest ? 'ベストショットに選びました' : 'ベストショットを解除しました');
    } catch (e) { toast(errMsg(e), true); }
  };

  $('viewer-del').onclick = async () => {
    const p = viewing;
    const yes = await ask('この写真を削除しますか？', 'チームの全員の画面から消えます。元に戻せません。', '削除する', true);
    if (!yes) return;
    try {
      await api.deletePhoto(team.no, p, p.id === team.best);
      closeViewer();
      await refresh();
      toast('削除しました');
    } catch (e) { toast(errMsg(e), true); }
  };

  // ── チームを変える ──
  $('switch-btn').onclick = async () => {
    const yes = await ask('チームを変更しますか？', 'チーム番号を入れ直す画面に戻ります。写真は消えません。', '変更する', false);
    if (!yes) return;
    clearTeam();
    $('team-no-input').value = String(team.no);
    team = null;
    try { teamsList = await api.getTeams(); } catch (e) { /* 一覧は表示用なので無視 */ }
    showStart();
  };

  // ── 集合までのカウントダウン ──
  function tick() {
    const left = new Date(CFG.deadline).getTime() - Date.now();
    const stat = $('time-stat');
    if (left > 3 * 60 * 60 * 1000) {
      $('time-k').textContent = '集合時刻';
      $('time-v').textContent = new Date(CFG.deadline).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
      stat.classList.remove('urgent');
    } else if (left > 0) {
      const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
      $('time-k').textContent = '集合まで';
      $('time-v').textContent = m + ':' + String(s).padStart(2, '0');
      stat.classList.toggle('urgent', left < 10 * 60 * 1000);
    } else {
      $('time-k').textContent = '集合時刻';
      $('time-v').textContent = '集合！';
      stat.classList.add('urgent');
    }
  }
  tick();
  setInterval(tick, 1000);

  // ── チームの写真をリアルタイムで反映 ──
  let refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (!$('viewer').hidden || !$('confirm').hidden) return;
      if (Object.values(pending).some((n) => n > 0)) return;
      refresh();
    }, 400);
  }
  function startLive() {
    stopLive();
    unsubscribe = api.subscribe(team.no, scheduleRefresh);
    // リアルタイム通知が届かない環境向けに、30秒ごとにも確認
    pollTimer = setInterval(() => { if (!document.hidden) scheduleRefresh(); }, 30000);
  }
  function stopLive() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    clearInterval(pollTimer);
    pollTimer = null;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && team && !$('main').hidden) scheduleRefresh(); });

  // ── 起動 ──
  async function init() {
    $('load-error').hidden = true;
    const params = new URLSearchParams(location.search);
    const urlTeam = parseTeamNo(params.get('team'));
    const no = urlTeam || loadTeam();
    if (no && TEAM_NOS.indexOf(no) !== -1) {
      pickedTeam = no;
      $('team-no-input').value = String(no);
      $('start').hidden = true;
      $('main').hidden = false;
      await openTeam(no);
    } else {
      showStart();
    }
    try { teamsList = await api.getTeams(); renderStart(); } catch (e) { if (!$('start').hidden) showLoadError(e); }
  }
  init();
})();
