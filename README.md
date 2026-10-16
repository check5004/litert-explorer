# LiteRT Lab

日本語のセマンティック検索・画像の物体検出・意味による問い合わせ分類・日本語/英語の生成を、実際の LiteRT 系 SDK で動かすブラウザ内で推論する静的Webアプリの教育用PoCです。検索結果・画像の検出枠・ログはモデルの実出力から作ります。疑似推論や、失敗時のサンプル結果への置き換えはありません。

## GitHub Pagesで公開する

GitHub Pagesで配信できます。サーバー側の推論処理・APIキー・データベースはありません。CPU/WASM単一スレッドなので、Pagesでは設定できないCOOP/COEPやcross-origin isolationを必要としません。

1. このソースをPublicリポジトリのmainへ置き、Settings → Pages → Build and deployment → SourceをGitHub Actionsに設定。
2. .github/workflows/pages.ymlが、ロック済み依存と公開モデルを取得し、SHA-256照合・テスト・ビルド後にdistをPagesへ公開。
3. npm run buildのVite baseは相対パスです。/litert-explorer/のようなリポジトリ配下でWorker、WASM、モデル、画像、Service Workerが動くようにしています。

470 MBのモデルはGitにコミットしません。GitHub Actionsのビルド時に取得し、約764 MBの静的Pages artifactとして配信します。Git LFSは使用しません。CoreとDecision資産は同一オリジンです。LLMのQwen3約345 MB / SmolLM2約374 MBモデルはPagesに含めず、明示操作で公式Hugging Face/CDNから取得するか、同じモデルのローカルファイルを選びます。入力文の外部送信やリモート推論はありません。初回の検索モデル取得は実行ボタンを押した時だけです。

GitHubの公式制限は公開サイト最大1 GB、デプロイ10分、転送量soft limit100 GB/月です。764 MB級のフル取得を繰り返すと転送量に達しやすいため、大人数向け常設サービスの構成ではありません。画像だけならモデル約14 MBです。

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

## 4つの実験

- 意味検索: 架空の日本語社内文書8件を、その場で全件埋め込み。検索文も同じモデルで384次元へ変換し、L2正規化・コサイン類似度で並べます。保存済みの検索用埋め込みは使いません。
- 画像検出: 4枚のAI生成画像、またはローカル画像を入力。EfficientDet-Lite0の生の確率・box delta出力から位置を復元し、しきい値とNMSで結果を選びます。画像はPNG/JPEG/WebP、20 MB・4,000万画素まで。
- 問い合わせの意味で分類: EmbeddingGemma 2 Text 270M を MediaPipe Decision Maker 1.1.0 経由で実行。日本語の架空の問い合わせと候補の説明文を比較し、未加工の分布・SDK confidence・関数境界の時間を表示します。分類専用に学習したヘッドや自動業務処理ではありません。初回追加取得は約183 MBです。
- 文章生成: @litert-lm/core 0.18.0 の実験的CPU経路。日本語向けQwen3 0.6B（約345 MB）を初期選択し、英語比較用SmolLM2 360M（約374 MB）に切り替えられます。選択だけでダウンロードはしません。どちらも公式Web対応モデル一覧外の資産で、事実の誤り・意味の変化・指示に従わない出力があります。数GBの空きメモリがあるPC向けです。SDKの実チャンク・token数・TTFTとMain到着時間を区別します。
- 観測: 入力、前処理、Tensor作成、model.run、output.data、後処理を実測。クリックして実値・形状・先頭要素・数式を確認できます。JSONで実行ログと全384次元を保存できます。
- 静的グラフ: 各演算の形状、MAC/FLOP相当の推定、未対応演算を表示します。内部演算ごとの実測時間はN/Aです。

## 実践デモの見方（2026-10-16改修）

各タブは「入力を選ぶ → 試す → 結果とこの端末の速さ」の順です。短いフロー図は処理の説明であり、内部の層が動く様子を演出するものではありません。関数ごとの実値、演算表、JSONログ、通信の記録は折り畳んでいます。

- 実測：この端末の今回の処理。モデル取得、初期準備、推論の時間を分けて表示します。初期準備が取得を含むCoreでは、足し合わせる項目ではないことを明記します。
- 推定：検索・画像モデルの既知MAC小計。未推定演算を除くため完全な計算量ではなく、速度でもありません。
- 未計測・取得不可：まだ実行していない値は「未計測」。Decision/LLMのMACは未推定、内部各層の時間は公開SDKでは取得できません。
- 失敗や非対応：入力・通信・メモリ・ランタイムのエラーは、その理由と再試行の案内を表示します。成功したような結果へ置き換えません。

日本語LLMのモデル情報・品質の限界・検証範囲は docs/generation-lab.md、現在の実行確認は docs/verification.md を参照してください。

公開版 commit d2a1568 を2026-10-16にクラウドChromeで操作し、新UIでの画像検出・日本語検索・問い合わせ分類と、Qwen3の日本語生成を確認しました。Qwen3の会議案内は約30.48秒で生成し、取得6.65秒・検証と初期化9.57秒を分離表示しました。日本語の出力成功は品質保証ではありません。176単体テスト、型検査・build・実Core推論CIも別に合格しています。詳細と未確認範囲は検証記録を参照してください。

## 正直な観測範囲

公開SDKに内部演算の逐次実行・各層の時間・中間テンソルの一般的な取得APIはありません。このアプリはそれらを捏造しません。動いているステップ表示は実際の関数開始/終了通知で、モデル内部の進捗率ではありません。ファイル取得の進捗は受信バイト数だけです。

- 初期準備: Coreでは init() 前からモデル・トークナイザー等の準備完了まで。検索では8文書の埋め込みを含みます。モデル取得はその中のbytes()取得区間として別表示します。
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
- Core/Decisionは同一オリジンからモデル/WASM/トークナイザー/同梱画像を取得します。LLMは明示操作で固定の公式モデルURLをGETします。取得先にはIP等の通常の接続情報が渡りますが、Cookie・認証情報・入力文は付けません。npm run assets（GitHub Actionsのビルドを含む）だけはモデル提供元へダウンロード要求を送ります。
- 共通シェルのCSPは同一オリジンとLLM用の確認済みHugging Face/CDNを許可します。Mainの通信ガードはアプリ内の静的GET/HEADだけを許可し、LLMタブ選択中の固定モデルGETだけを例外にします。Cookie・入力本文・追加ヘッダー・任意queryを付けません。Decision Blob Workerはこの共通CSPを継承しますが、SDK前の独立した完全一致許可リストでGoogle指標送信を拒否します。Coreトークナイザーのremote model読み込みも無効です。悪意ある同一オリジンのコードに対する隔離ではありません。
- 本番ビルドの「必要なファイルを保存」を押すとService Workerが同一オリジンのホームのCore実験用資産約550 MBをCacheStorageに保存します。Decisionの追加資産はこの保存一覧から除外しています。Core実験は完了後にオフライン再読み込み可能な設計です。空き容量・ブラウザのevictionに依存します。
- Decision SDKには定期・close時のGoogle利用指標送信処理があります。SDKに公開オプトアウトはなく、アプリの通信ガードが転送前に拒否します。公開Chromeで定期・close時の拒否イベントを確認しています。ブラウザ全体の通信捕捉ではありません。通信ログは送信先・methodと許可/遮断だけで、本文・ヘッダー・APIキーを保存しません。
- 保存するのはアプリと公開モデルです。検索文・アップロード画像は永続保存しません。JSONダウンロードには入力文・埋め込み・結果が含まれるので、共有前に確認してください。
- 中止はWorkerごと終了するため、同期WASM実行中でも本体を停止できる設計です。次回は再読み込みします。正常/異常どちらでも作成済みTensorはfinallyでdeleteします。

## Decision追加実験の検証状況

2026-10-13に公開PagesをクラウドChromeで実行し、モデルサイズ/SHA-256、実際の日本語4例、初回/再実行、空選択の拒否、推論中のWorker強制終了と再初期化後の実推論を確認しました。初回evaluateChoiceは約3.85秒、同じモデルでの再実行は約0.75秒でした。端末共通の性能保証ではありません。

実際のSDK指標POSTは自然なタイマーで約61.3秒後、別の新規Workerのcloseでは約29.5秒後に発生し、どちらもアプリの通信ガードがnative fetchの前に拒否することを画面の実イベントとソースで確認しました。これはブラウザ全体のパケット監査ではなく、SDKの公開オプトアウトでもありません。CSP拒否イベントが0件なのは、その前のガードで止めているためです。

SDK 1.1.0公式サンプルの5メソッドPromise互換処理を使用します。SDK更新時には再検証が必要です。Decision追加時には単体/状態遷移テスト33件を含む全46件が合格。Nodeの検証もブラウザ確認とは別に実施しました。SHA-256のため157 MiBのモデルバッファを保持し、実メモリ消費はそれより増えます。既存Service Worker管理下、オフライン、モバイル・Safari・Firefox、すべての異常系は未確認です。

## 4つのタブを同じ画面で使う

01 検索・02 画像・03 分類・04 文章生成を、共通のタブで切り替えます。iframeや別ページの埋め込みではなく、必要な操作画面だけを遅延ロードするコンポーネントです。URLの #search / #detect / #decision / #generation で直接選択でき、従来のdecision/とgeneration/も対応するタブへ移動します。戻る・進む、左右矢印・Home・Endでも切り替えられます。

切り替えると直前のWorkerを終了し、モデルを再利用しません。同じタブ内の繰り返し実行では再利用できます。LLMは確認チェックも解除します。Main側の中止不能なファイル読取・SHA処理が残る場合は、終了するまで次のモデル読み込みを受け付けません。タブ選択だけで大きなモデルやSDKは取得しません。操作画面と小さな静的情報・サンプル画像の取得はあります。

UIは幅が狭いと2列のタブに切り替わるCSSを用意しています。以前の独立ページでの実ブラウザ結果は以下に履歴として残しています。統合版commit 3c794575f6d0579e388508081021e3abab2a1454は2026-10-13に公開Chromeで実操作し、4タブ内のDecision・英語生成・画像の実推論、LLM取得中/生成中のタブ離脱と再表示、Core検索の読込中離脱、Back/Forward、Endキー、従来リンクの移動先を確認しました。LLMの再表示では結果・計測が消え、モデルと確認チェックをやり直す状態になります。143単体テスト・production build・実Core推論テストも別途合格。デスクトップの4列を視覚確認していますが、狭幅の実描画・モバイル端末・オフラインを確認済みとは扱いません。詳細はdocs/verification.md。

## LLM追加実験の状態

2026-10-13、統合前の公開Pagesのgeneration/をクラウドChrome 154（Linux）で実操作しました。公式374 MBモデルのCORS取得・サイズ/SHA-256検証後に、本物の英語生成を確認しています。最初の架空例はsendMessageStreaming 16.63秒、Mainへの初文字列16.66秒、SDK TTFT 11.75秒、21 decode tokens / 20実チャンク。別の短い例を同じEngineで繰り返すと11.91秒でした。入力が違うため、純粋なcold/warm性能比較ではありません。実応答は一文指示を守らず意味が変わることもあり、品質の限界は残ります。

入力変更時の旧出力・計測消去、空入力と日本語の拒否、実行中のStopによるWorker破棄と中断表示、明示的な再取得・新規初期化後の実生成（20.08秒・40 SDK decode tokens）、モデル解放による再実行無効化を確認しました。Nodeでのピーク約2.7 GiBはブラウザのメモリ計測ではありません。CPUのチャンクは終了付近にまとまって届き、文字送り演出はしません。ブラウザ全通信の捕捉、ローカルモデルFile経路、既存Service Worker管理下、オフライン、モバイル・Safari・Firefox、メモリ回収量は未確認です。全106件の単体テストは実ブラウザ検証と区別しています。

SDK 0.18.0、LLM側helper 2.0.0、Asyncify/relaxed SIMDのWASMを固定し、Core側helper 2.5.3は維持します。約34.85 MBのランタイムだけをPagesに含め、373,719,040-byteのモデルは含めません。SHA-256とサイズを照合してからWorkerへ所有権移譲します。Mainのファイル読取/ハッシュは中止不能なので、停止後も終了まで次の読込を禁止し、即時メモリ回収とは表示しません。詳細はdocs/generation-lab.md。

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
