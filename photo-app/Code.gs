/**
 * とるぞ！フォトミッションラリー ミッションアプリ（サーバー側）
 *
 * ── 設定はこのブロックだけ変えればOK ──────────────────────
 */

// 写真を保存するGoogleドライブのフォルダ名（マイドライブ直下に自動で作られます）
const FOLDER_NAME = 'とるぞ！フォトミッションラリー 写真';

// チーム数
const TEAM_COUNT = 4;

// 撮影の終了時刻（集合時刻）。アプリにカウントダウンが出ます
const DEADLINE = '2026-12-13T16:20:00+09:00';

// お題の一覧。チームごとに違うお題にしたいときは、ここに増やして TEAM_MISSIONS で割り当てます
const MISSIONS = {
  1: { title: '天守閣をバックに全員ジャンプ', tag: 'チーム × 大阪城',
       desc: '天守閣と、宙に浮いた全員が1枚に入っていればクリア。人の少ない広場で撮ろう。' },
  2: { title: '遠近法トリックで天守閣を使う', tag: 'チーム × 大阪城',
       desc: '天守閣をつまむ？ 手のひらに乗せる？ 持ち上げる？ アイデア勝負！' },
  3: { title: '喜・怒・哀・楽・無', tag: '表情',
       desc: '5人で1つずつ表情を担当して1枚に。担当決めからスタート！' },
  4: { title: '城内でいちばん大きな石「蛸石」と全員で写る', tag: '大阪城 × 発見',
       desc: 'ヒント：本丸の入口「桜門」をくぐってすぐ。石の大きさが伝わるように撮ろう。' },
  5: { title: '大阪城で映画のポスター風', tag: 'チーム × 表情',
       desc: '全員でワンシーンを演出して、映画のタイトルもつけよう。16時以降は夕日の光がきれい！' },
};

// チームごとのお題と、回るおすすめ順（同じ場所に全チームが集中しないよう順番をずらしています）
const TEAM_MISSIONS = {
  1: [1, 2, 3, 4, 5],
  2: [4, 1, 2, 3, 5],
  3: [3, 4, 1, 2, 5],
  4: [2, 3, 4, 1, 5],
};

// ──────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('index');
  const team = Number(e && e.parameter && e.parameter.team);
  t.team = validTeam_(team) ? String(team) : '';
  return t.evaluate()
    .setTitle('とるぞ！ミッション')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** アプリ全体の設定（チーム数・締切） */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const teams = [];
  for (let i = 1; i <= TEAM_COUNT; i++) {
    teams.push({ no: i, name: props.getProperty('team_' + i + '_name') || '' });
  }
  return { teams: teams, deadline: DEADLINE };
}

/** チームの情報・お題・写真をまとめて返す */
function getTeam(teamNo) {
  teamNo = Number(teamNo);
  if (!validTeam_(teamNo)) throw new Error('チーム番号は1〜' + TEAM_COUNT + 'で入力してください');
  const props = PropertiesService.getScriptProperties();
  const best = props.getProperty('team_' + teamNo + '_best') || '';

  const photosByMission = {};
  const files = teamFolder_(teamNo).getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const m = /^m(\d+)_/.exec(f.getName());
    if (!m) continue;
    const id = f.getId();
    (photosByMission[m[1]] = photosByMission[m[1]] || []).push({
      id: id,
      at: f.getDateCreated().getTime(),
      thumb: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w600',
      large: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1600',
    });
  }

  const missions = TEAM_MISSIONS[teamNo].map(function (mid, i) {
    const photos = (photosByMission[mid] || []).sort(function (a, b) { return a.at - b.at; });
    return Object.assign({ id: mid, order: i + 1, photos: photos }, MISSIONS[mid]);
  });

  return {
    no: teamNo,
    name: props.getProperty('team_' + teamNo + '_name') || '',
    best: best,
    missions: missions,
    deadline: DEADLINE,
  };
}

/** チーム名を保存 */
function setTeamName(teamNo, name) {
  teamNo = Number(teamNo);
  if (!validTeam_(teamNo)) throw new Error('チーム番号が正しくありません');
  name = String(name || '').trim().slice(0, 30);
  PropertiesService.getScriptProperties().setProperty('team_' + teamNo + '_name', name);
  return getTeam(teamNo);
}

/** 写真をアップロード（dataUrl は端末側で縮小済みのJPEG） */
function uploadPhoto(teamNo, missionId, dataUrl) {
  teamNo = Number(teamNo);
  missionId = Number(missionId);
  if (!validTeam_(teamNo)) throw new Error('チーム番号が正しくありません');
  if (TEAM_MISSIONS[teamNo].indexOf(missionId) === -1) throw new Error('このチームのお題ではありません');

  const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('画像ファイルを選んでください');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('画像が大きすぎます（8MBまで）');

  const ext = m[1] === 'image/png' ? 'png' : 'jpg';
  const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HHmmss');
  const blob = Utilities.newBlob(bytes, m[1], 'm' + missionId + '_' + stamp + '_' + Utilities.getUuid().slice(0, 6) + '.' + ext);
  const file = teamFolder_(teamNo).createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return getTeam(teamNo);
}

/** 写真を削除（ドライブのゴミ箱へ移動。30日間は復元できます） */
function deletePhoto(teamNo, fileId) {
  teamNo = Number(teamNo);
  const file = fileInTeam_(teamNo, fileId);
  file.setTrashed(true);
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('team_' + teamNo + '_best') === fileId) {
    props.deleteProperty('team_' + teamNo + '_best');
  }
  return getTeam(teamNo);
}

/** チームのベストショットを指定（同じ写真をもう一度指定すると解除） */
function setBest(teamNo, fileId) {
  teamNo = Number(teamNo);
  fileInTeam_(teamNo, fileId);
  const props = PropertiesService.getScriptProperties();
  const key = 'team_' + teamNo + '_best';
  if (props.getProperty(key) === fileId) props.deleteProperty(key);
  else props.setProperty(key, fileId);
  return getTeam(teamNo);
}

/** 初回だけ手動で実行：ドライブへの権限を許可し、フォルダを作る */
function setup() {
  for (let i = 1; i <= TEAM_COUNT; i++) teamFolder_(i);
  Logger.log('準備完了：マイドライブに「' + FOLDER_NAME + '」フォルダを作りました');
}

// ── 内部用 ──

function validTeam_(n) {
  return Number.isInteger(n) && n >= 1 && n <= TEAM_COUNT && !!TEAM_MISSIONS[n];
}

function rootFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function teamFolder_(teamNo) {
  const root = rootFolder_();
  const name = 'チーム' + teamNo;
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function fileInTeam_(teamNo, fileId) {
  if (!validTeam_(teamNo)) throw new Error('チーム番号が正しくありません');
  const folder = teamFolder_(teamNo);
  let file;
  try { file = DriveApp.getFileById(String(fileId)); } catch (err) { throw new Error('写真が見つかりません'); }
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folder.getId()) return file;
  }
  throw new Error('このチームの写真ではありません');
}
