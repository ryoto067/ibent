# とるぞ！ミッションアプリ

スマホで開くWebアプリです。チーム番号を入れるとそのチームのお題が表示され、お題ごとに写真をアップロードしてチーム全員で共有できます。参加者のログインは不要で、ホーム画面に追加すればアプリのように使えます。

- 画面：`index.html` / `app.js`
- 設定（お題・チーム・集合時刻・接続先）：`config.js`
- 写真とデータの保存先：Supabase（無料）
- 公開先：Vercel（無料）

`config.js` の接続先が空のままだと**デモモード**で動きます（写真はその端末の中だけ）。見た目や操作の確認に使えます。

## 1. Supabase を用意する（10分・最初の1回だけ）

1. https://supabase.com で「Start your project」→ GitHub か メールで登録
2. 「New project」を作成
   - Name：`toruzo`
   - Database Password：自動生成でOK（使いません）
   - Region：**Northeast Asia (Tokyo)**
3. 作成が終わったら、左メニューの「SQL Editor」を開く
4. `supabase.sql` の中身を全部貼り付けて「Run」→「Success」と出ればOK
5. 左メニューの「Project Settings」→「API」（または「Data API」と「API Keys」）を開き、次の2つをコピー
   - **Project URL**（`https://xxxx.supabase.co`）
   - **anon public** キー（`eyJ...` で始まる長い文字列、または `sb_publishable_...`）
6. `config.js` の `supabaseUrl` と `supabaseAnonKey` に貼り付ける

※ anon キーは公開しても大丈夫な種類のキーです。「service_role」や「secret」と書かれたキーは絶対に貼らないでください。

## 2. Vercel で公開する（5分）

ターミナルで次を実行します。

```sh
cd /Users/ryoto/Documents/_claude/toruzo/mission-app
vercel login          # ブラウザが開くのでログイン（初回だけ）
vercel deploy --prod  # 質問はすべて Enter でOK
```

最後に表示される `https://〇〇.vercel.app` がアプリのURLです。

## 3. 参加者への配り方

- 全体LINEにURLを流して、各自でチーム番号を入力してもらう
- チームごとのURLを作ると入力を飛ばせます：`https://〇〇.vercel.app/?team=1` 〜 `?team=4`（QRコードにすると便利）
- 「ホーム画面に追加」すると、アイコンから開けます（iPhone：共有ボタン →「ホーム画面に追加」）

## お題やチームを変えたいとき

`config.js` を編集して、もう一度 `vercel deploy --prod` を実行するだけです。URLは変わりません。

- お題の文面：`missions`
- チームごとのお題とおすすめ順：`teamMissions`
- チームを増やす：`teamMissions` に行を足し、`supabase.sql` の `insert into public.teams(no) values ...` に番号を足して SQL Editor でもう一度実行

## 当日のあとで

- 写真は Supabase の「Storage」→「photos」にチームごとのフォルダで入っています。まとめてダウンロードできます
- テストで上げた写真は、アプリの「削除」か Supabase の「Table Editor」→ photos から消してください
- 無料プランは1週間アクセスがないとプロジェクトが一時停止します。下見のあとに1週間以上空く場合は、本番の前日にアプリを1回開いておけば大丈夫です（停止していても Supabase の画面から再開できます）

## 知っておくこと

- URLを知っている人は誰でも写真を見たり、アップロード・削除したりできます。URLは参加者と運営だけに共有してください
- 写真はアップロード時に自動で縮小されます（長辺1600px、一覧用に小さい画像も作成）
- 他のメンバーがアップロードした写真は、ほぼすぐに自分の画面にも表示されます
- 本番前に、下見のときに運営のスマホで実際に試しておくのがおすすめです
