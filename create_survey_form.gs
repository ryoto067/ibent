/**
 * とるぞ！フォトミッションラリー 終了アンケートを自動作成するスクリプト
 *
 * 使い方：
 * 1. https://script.google.com を開き「新しいプロジェクト」
 * 2. 最初からあるコードを全部消して、このファイルの中身を貼り付ける
 * 3. 上の関数選択が「createSurvey」になっていることを確認して「実行」
 * 4. 初回は権限の確認が出るので、自分のアカウントで許可する
 * 5. 「実行ログ」に回答用URLと編集用URLが表示される
 *    （フォームはGoogleドライブのマイドライブにも保存されます）
 */
function createSurvey() {
  var form = FormApp.create('とるぞ！フォトミッションラリー 参加者アンケート');
  form.setDescription(
    '本日はご参加いただきありがとうございました！\n' +
    '今後のイベントづくりの参考にさせていただきます。（所要時間：約2分）'
  );
  form.setProgressBar(true);

  // 1. 総合満足度
  form.addScaleItem()
    .setTitle('イベント全体の満足度を教えてください')
    .setBounds(1, 5)
    .setLabels('不満', 'とても満足')
    .setRequired(true);

  // 2. 楽しかったプログラム
  form.addCheckboxItem()
    .setTitle('楽しかったプログラムを選んでください（複数選択可）')
    .setChoiceValues([
      'アイスブレイク・自己紹介',
      '撮影ミッション',
      'LINEでの写真投票・ベストショット賞',
      '懇親の時間',
      '集合写真'
    ])
    .showOtherOption(true);

  // 3. 交流
  form.addMultipleChoiceItem()
    .setTitle('イベントを通して新しいつながりはできましたか？')
    .setChoiceValues([
      'チーム外の人とも仲良くなれた',
      'チーム内の人と仲良くなれた',
      'あまり話せなかった'
    ])
    .setRequired(true);

  // 4. お題の難易度
  form.addMultipleChoiceItem()
    .setTitle('お題の難易度はどうでしたか？')
    .setChoiceValues(['簡単すぎた', 'ちょうどよかった', '難しすぎた']);

  // 5. 時間
  form.addMultipleChoiceItem()
    .setTitle('イベントの長さ（2時間）はどうでしたか？')
    .setChoiceValues(['短い', 'ちょうどよい', '長い']);

  // 6. 参加費
  form.addMultipleChoiceItem()
    .setTitle('参加費500円はどう感じましたか？')
    .setChoiceValues(['安い', 'ちょうどよい', '高い']);

  // 7. 知ったきっかけ
  form.addMultipleChoiceItem()
    .setTitle('このイベントを何で知りましたか？')
    .setChoiceValues(['Instagram', 'ポスター', '友人・知人からの紹介'])
    .showOtherOption(true)
    .setRequired(true);

  // 8. 団体への興味
  form.addScaleItem()
    .setTitle('私たちの団体への興味は高まりましたか？')
    .setBounds(1, 5)
    .setLabels('高まらなかった', 'とても高まった')
    .setRequired(true);

  // 9. 次回参加意向
  form.addMultipleChoiceItem()
    .setTitle('次回のイベントにも参加したいですか？')
    .setChoiceValues(['ぜひ参加したい', '内容によっては参加したい', '参加しないと思う'])
    .setRequired(true);

  // 10. Instagramフォロー
  form.addMultipleChoiceItem()
    .setTitle('団体のInstagramをフォローしましたか？')
    .setChoiceValues(['フォローした', 'これからフォローする', 'フォローしていない']);

  // 11〜13. 自由記述
  form.addParagraphTextItem()
    .setTitle('よかった点・印象に残ったことを教えてください');
  form.addParagraphTextItem()
    .setTitle('改善してほしい点があれば教えてください');
  form.addParagraphTextItem()
    .setTitle('次にやってほしいイベントのアイデアがあれば教えてください');

  Logger.log('回答用URL：' + form.getPublishedUrl());
  Logger.log('編集用URL：' + form.getEditUrl());
}
