# LiteRT Lab

日本語のセマンティック検索・画像の物体検出・意味による問い合わせ分類を、実際の LiteRT 系 SDK で動かすブラウザ内で推論する静的Webアプリの教育用PoCです。検索結果・画像の検出枠・ログはモデルの実出力から作ります。疑似推論や、失敗時のサンプル結果への置き換えはありません。

## GitHub Pagesで公開する

GitHub Pagesで配信できます。サーバー側の推論処理・APIキー・データベースはありません。CPU/WASM単一スレッドなので、Pagesでは設定できないCOOP/COEPやcross-origin isolationを必要としません。

1. このソースをPublicリポジトリのmainへ置き、Settings → Pages → Build and deployment → SourceをGitHub Actionsに設定。
2. .github/workflows/pages.ymlが、ロック済み依存と公開モデルを取得し、SHA-256照合・テスト・ビルド後にdistをPagesへ公開。
3. npm run buildのVite baseは相対パスです。/litert-explorer/のようなリポジトリ配下でWorker、WASM、モデル、画像、Service Workerが動くようにしています。

470 MBのモデルはGitにコミットしません。GitHub Actionsのビルド時に取得し、約730 MBの静的Pages artifactとして配信します。Git LFSは使用しません。すべてのブラウザ用資産はPagesと同じオリジンに置くため、Hugging FaceへのCORS依存やユーザー入力の外部送信はありません。初回の検索モデル取得は実行ボタンを押した時だけです。

GitHubの公式制限は公開サイト最大1 GB、デプロイ10分、転送量soft limit100 GB/月です。730 MB級のフル取得を繰り返すと転送量に達しやすいため、大人数向け常設サービスの構成ではありません。画像だけならモデル約14 MBです。

公式資料: [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)、[custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## ローカル起動

すぐに起動する場合: macOS/Linux は ./run-local.sh、Windows は run-local.cmd。初回のモデル取得サイズを表示してから準備します。

Node.js 22.12以上（検証環境:24.19.0）、モダンなChrome/Edgeなど、数GBの空きメモリを推奨します。モデルが大きいためモバイル端末ではメモリ不足になり得ます。

```bash
npm ci --ignore-scripts
npm run assets
npm run build
npm run preview
```

表示されたローカルURLを開きます。file://ではWorker/WASMを読み込めません。npm run assets は公開モデル約470 MB、画像モデル約14 MB、トークナイザー約9 MB、Decision用モデル・WASM等約183 MBを取得し、SHA-256を照合します。完全版にモデルが同梱されている場合は照合だけです。npm install の後もWASMをコピーするため assets を実行してください。開発は npm run dev。

## 3つの実験

- 意味検索: 架空の日本語社内文書8件を、その場で全件埋め込み。検索文も同じモデルで384次元へ変換し、L2正規化・コサイン類似度で並べます。保存済みの検索用埋め込みは使いません。
- 画像検出: 4枚のAI生成画像、またはローカル画像を入力。EfficientDet-Lite0の生の確率・box delta出力から位置を復元し、しきい値とNMSで結果を選びます。画像はPNG/JPEG/WebP、20 MB・4,000万画素まで。
- 問い合わせの意味で分類: EmbeddingGemma 2 Text 270M を MediaPipe Decision Maker 1.1.0 経由で実行。日本語の架空の問い合わせと候補の説明文を比較し、未加工の分布・SDK confidence・関数境界の時間を表示します。分類専用に学習したヘッドや自動業務処理ではありません。初回追加取得は約183 MBです。
- 観測: 入力、前処理、Tensor作成、model.run、output.data、後処理を実測。クリックして実値・形状・先頭要素・数式を確認できます。JSONで実行ログと全384次元を保存できます。
- 静的グラフ: 各演算の形状、MAC/FLOP相当の推定、未対応演算を表示します。内部演算ごとの実測時間はN/Aです。

## 正直な観測範囲

公開SDKに内部演算の逐次実行・各層の時間・中間テンソルの一般的な取得APIはありません。このアプリはそれらを捏造しません。動いているステップ表示は実際の関数開始/終了通知で、モデル内部の進捗率ではありません。ファイル取得の進捗は受信バイト数だけです。

- 全体時間: Worker内の入力検証から後処理まで。coldはランタイム取得、モデル取得/コンパイル、検索用文書の初期インデックスを含みます。
- モデル実行+読み戻し: 単一検索文または画像のmodel.runからoutput.data完了までのwall-clock時間です。GPUカーネル時間ではありません。
- 画像のCanvasリサイズはメインスレッドの別計測としてJSONに記録します。Worker全体時間には含みません。
- warmは同じWorkerでモデルを再利用することを意味します。ブラウザやOSのキャッシュの「完全な冷却」を意味しません。
- CPU/WASM・単一スレッドに固定しました。GPU混在/fallbackを表示上だけ演出しません。
- 静的MAC/FLOPはモデルファイルから算出。未推定の演算が残るため小計です。演算ノード数のカバレッジと、計算量/実時間の網羅率は異なります。

## モデルと互換性

|用途|モデル/取得元|契約|
|---|---|---|
|検索|sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2、Bombek1によるTFLite変換、Apache-2.0|INT32入力2本 [1,128]、FLOAT32 [1,384]。変換モデルにmasked mean poolingを内包|
|画像|Google MediaPipe EfficientDet-Lite0 float32/1、Apache-2.0|FLOAT32 RGB [1,320,320,3]、scores [1,19206,90]とbox deltas [1,19206,4]|

@litertjs/core 2.5.3の公開npm版はINT64入力を受け取れないため、MiniLMの入力境界のdtypeを4バイトだけINT32に変更しています。既存CAST/RESHAPEと整合する入力契約に限った変更で、重み・演算・全ての他のバイトを保ちます。元モデルとのnative LiteRT比較は4ケースでビット単位一致。変更箇所とSHAは public/models/minilm-int32.adaptation.json、詳しい説明は docs/compute-method.md。

トークン化だけに @huggingface/transformers 3.7.2 を使用します。return_tensor:falseで通常のID配列を受け取り、ONNXで推論しません。126内容トークンにBOS/EOSを加えて128へpadするため、長文でもEOSを落としません。日本語文書8件・通常の3クエリのID一致は独立検証済みですが、Precompiled文字正規化の実装には元のRust tokenizersと差があり、半角濁点・結合文字など一部UnicodeでIDが異なることがあります。厳密な本番用途には同一トークナイザーのWASM化等が必要です。

## サンプルデータの由来

src/corpus.tsの8文書と検索例は、この教育用デモのために作成した架空の固定データです。実在の会社の文書、利用者の会話、実際に入力された検索履歴を転用したものではありません。初期表示とテストは同じ固定データを使用します。4枚の同梱画像もAI生成で、生成時の内容説明はpublic/samples/provenance.jsonに記録しています。

## データ・ネットワーク

- 入力文・ユーザー画像の外部送信、リモート推論、解析/広告、外部フォントはありません。
- ブラウザは同一オリジンからモデル/WASM/トークナイザー/同梱画像を取得します。npm run assets（GitHub Actionsのビルドを含む）だけはモデル提供元へダウンロード要求を送ります。
- ページのCSPでconnect-srcを同一オリジンに限定。DecisionはBlob WorkerでCSPを継承し、SDK読込前の正確なURL許可リストでも通信を制限します。トークナイザーのremote model読み込みも無効です。外部への通信を許可していません。
- 本番ビルドの「必要なファイルを保存」を押すとService Workerが同一オリジンのホームのCore実験用資産約550 MBをCacheStorageに保存します。Decisionの追加資産はこの保存一覧から除外しています。Core実験は完了後にオフライン再読み込み可能な設計です。空き容量・ブラウザのevictionに依存します。
- Decision SDKには定期・close時のGoogle利用指標送信処理があります。SDKに公開オプトアウトはなく、アプリの通信ガードが転送前に拒否します。ブラウザ検証完了までは遮断の実証済みとは扱いません。通信ログは送信先・methodと許可/遮断だけで、本文・ヘッダー・APIキーを保存しません。
- 保存するのはアプリと公開モデルです。検索文・アップロード画像は永続保存しません。JSONダウンロードには入力文・埋め込み・結果が含まれるので、共有前に確認してください。
- 中止はWorkerごと終了するため、同期WASM実行中でも本体を停止できる設計です。次回は再読み込みします。正常/異常どちらでも作成済みTensorはfinallyでdeleteします。

## Decision追加実験の状態

public/decision/は実SDKだけを呼ぶCPU専用実験です。Nodeで日本語出力を確認し、通信ポリシー・状態遷移・ライフサイクルの単体テスト33件を追加しています。実際のブラウザでのモデル起動、自然な60秒後の指標送信遮断、close送信遮断、中止と再初期化は公開後に検証する予定です。未検証を合格として扱いません。SHA-256のため157 MiBのモデルバッファを保持するのでメモリ消費が増えます。1.1.0公式サンプルの5メソッドPromise互換処理を使用し、SDK更新時には再検証が必要です。

## 検証状況（既存Core実験）

2026-10-13に公開GitHub Pagesを実際のクラウドChromeで確認しました。画像の実検出（デスク）、架空の検索例3件の実推論、cold/warmの繰り返し、読み込み中止と再実行、空検索・非画像ファイルの拒否、エラー後の再実行、実行JSONダウンロードを確認しています。Worker/WASMはcrossOriginIsolated=falseの通常のPages環境で動作しました。

この試験で見つかった圧縮HTTP転送の進捗表示を修正しました。Content-Lengthが圧縮済みサイズの場合、展開後の受信バイト数と比べず、受信MBだけを表示します。

確認済み: TypeScript型検査、production build、JavaScript単体テスト13件、Python静的分析/変換38テスト、実際のLiteRT.js WASMでの日本語検索、および元/変換モデルのnative出力同値性。Nodeの最小ホストshimはtests内のみで、アプリ配布コードには含まれません。

未確認: 完全な通信先の捕捉、Service Workerの完全保存とオフライン再読み込み、モバイル・Safari・Firefoxでの互換性、大画像・破損画像などすべての異常系。デスクトップChromeでの確認を全ブラウザの受け入れ完了とは扱いません。

再現方法と検証範囲は docs/verification.md を参照。公開ソースには過去の実行ログ・監査JSON・証跡画像を同梱しません。

## 開発用テスト

```bash
npm test
npm run build
npm run test:integration
node tests/worker-integration.mjs
# Python依存/コマンド: docs/compute-method.md
# ブラウザが使える環境でのみ:
npm run preview
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

## 主なファイル

src/main.ts（UI/メイン側画像処理）、src/inference-worker.ts（実推論と実測）、src/tokenize.mjs（BOS/EOS保持）、src/detection.ts（アンカー復元/NMS）、src/math.mjs、src/corpus.ts。scripts/prepare-assets.mjsは固定URL/ハッシュ検証、scripts/analyze_tflite.pyは静的グラフ抽出。AI画像の生成情報はpublic/samples/provenance.json。

新規アプリコードはMIT。モデル・依存ライブラリのライセンスは licenses/THIRD_PARTY.md を参照。
