# 検証と再現方法

## これまでに確認した範囲

初期の実行確認（2026-10-09、Pages対応の再確認は2026-10-12）では、固定した @litertjs/core 2.5.3 の配布JS/WASMで実モデルを loadAndCompile し、model.run / output.data を実行しました。Node の最小script-loader host shimとWorkerホストを使用した確認であり、実ブラウザの動作確認ではありません。

- 配布Workerで、架空の日本語文書に対する検索3件、AI生成画像4件、空文字と不正pixel入力の拒否を確認。
- 生テンソルからの検出スコア、19,206アンカー、90ラベル、bbox復元式、正規化を独立に照合。
- MiniLM INT32境界変換は4バイトだけを変更。元モデルとのnative ai-edge-litert 2.1.0比較は4種類の決定的入力でbitwise同値。変換契約は public/models/minilm-int32.adaptation.json。
- トークナイザーの参照Rust実装との18ケース比較では17/18一致。残る半角濁点・結合文字のnormalizer差はREADMEに明記。
- 算術・入力・トークン境界・Pages URLのJavaScript単体テスト、Python静的解析/変換テスト38件、TypeScript型検査、production buildを確認。

過去の実行ログ、監査JSON、検出結果の証跡画像はこの公開リポジトリに含めません。テストは結果の再生ではなく、実行時に実モデルを呼び出してassertします。出力は環境によって変わります。公開用の検索例は固定の架空テキストで、利用者の入力履歴ではありません。

## 再現

```sh
npm ci --ignore-scripts
npm run assets
npm run build
npm test
npm run test:integration
node tests/worker-integration.mjs
npm run verify:pages
```

モデル取得は合計約484 MB、トークナイザーは約9 MBです。生成されるdocs内のレポートはローカルの検証用で、Git管理・Pagesの配布対象ではありません。

Pythonの依存と再現コマンドは docs/compute-method.md を参照してください。

## 公開Pagesでの実ブラウザ確認 · 2026-10-13

公開サイト https://check5004.github.io/litert-explorer/ をクラウドChrome 154（Linux）で操作し、commit 52e540d4ad7a1f5de1e1ff0470c7259ba349b431 の実行を確認しました。crossOriginIsolated=false、CPU/WASM単一スレッドです。

確認したフロー:

- 初期表示とデスク画像の実推論。laptop、book、cup等の検出枠と生出力由来のスコアを表示。
- 同じ画像のwarm再実行。初回とモデル再利用を区別して実測。
- 検索モデル読み込みを中止し、その後に再実行して完了。
- 架空の検索例3件が、それぞれ経費・在宅勤務・ログイン復旧の文書を最上位に表示。
- 実際の384次元とコサイン計算、6段階の関数境界の値を表示。
- 空検索と非画像テキストファイルを明示的に拒否。空検索エラー後の正常再実行。
- JSONダウンロードに実行時の入力・出力・測定・履歴が含まれることを確認。

アプリ由来のエラーは確認したログには見つかりませんでした。ブラウザ拡張機能由来のメタデータ送信エラーはあり、アプリのログとは区別しました。スクリーンショットと実行ログはローカル確認にのみ使用し、公開リポジトリには含めません。

圧縮配信時に、HTTP Content-Lengthと展開後ストリームの長さが異なる問題をこの試験で検出しました。ダウンロード進捗の修正では、圧縮または不明なContent-Encodingの総量を不明として扱います。正しい総量を得られない場合に割合を作らず、実際に受信したMBだけを表示します。identityの場合でも受信量が公称総量を超えたら総量を不明に戻します。5件の追加単体テストを用意しました。

## まだ確認していない範囲

次の項目をPASSとは扱いません。

- 全リクエストの捕捉による送信先の検証
- Service Workerへの大容量保存、容量不足、オフライン再読み込み
- Safari、Firefox、モバイルでの互換性とレスポンシブ
- 大画像・破損画像を含む異常系の網羅とメモリ解放の測定

実ブラウザが使える環境で npm run preview を起動し、CHROMIUM_PATHを指定して npm run test:browser を実行できます。tests/browser.mjsには追加の検証コードがありますが、このスクリプト全体の実行成功を主張するものではありません。上記の公開サイト確認はブラウザUIからの実操作です。
