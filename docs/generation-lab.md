# 日本語・英語のローカル生成実験

## 現在のモデル選択（2026-10-16）

初期選択は Qwen3 0.6B dynamic INT4、日本語の短い文章を言い換える例です。SmolLM2 360Mは英語の比較用として残します。選択欄に言語・モデルサイズを表示し、必要なメモリの注意を確認して「読み込む」を押すまで取得しません。モデルを変えると取得/推論を停止し、Worker・旧結果・ファイル選択をリセットします。

Qwen3の固定公開資産は Apache-2.0 / ungated、344,671,744 bytes。モデルURL・revision・SHA-256・最終CDNパスは src/generation/policy.mjs で固定します。Pagesへモデルを同梱しません。MainとWorkerの両方でサイズとSHA-256を検証し、選択モデルに対応する許可URLだけを使用します。

両モデルとも、この @litert-lm/core 0.18.0 の公式Web対応一覧外の実験経路です。他の推論SDKには置き換えていません。CPU/WASM単一スレッド、既存のネットワーク制限とService Workerポリシー確認を維持します。

### 日本語とメモリの限界

Qwen3 INT4のNode上の実SDK/WASM確認では、日本語の会議案内を丁寧な文へ変換できました。一方、一般知識の質問で誤答し、別の言い換えでは依頼する人と実行する人が逆になる出力もありました。「日本語を出せる」ことは「正しく使える」保証ではありません。意味・事実・敬語は人が確認してください。

Nodeの隔離した参考計測でピークRSSは約2.4〜2.8 GiBでした（モデルの読み込み方法で差があります）。これはブラウザの必要メモリや最低要件の実測ではありません。モデル受信・検証中の複製やブラウザ自体の使用量が加わるため、数GBの空きメモリを持つPCを推奨します。モバイル動作は保証しません。INT8候補は約614 MBで同じ試験のRSSが約3.91 GiBになり、事実誤答も残ったため、この選択UIには追加していません。

日本語の思考非表示設定はモデルの会話テンプレートに enable_thinking:false を渡します。内部の思考を観測・表示する機能ではありません。

### 時間の読み方

モデル取得・初期化と、今回の生成を分けます。生成は実際にSDKから返った文字列だけを表示します。初文字列のMain受信、Worker受信、SDK TTFTは別区間です。出力チャンク数とトークン数も異なります。MAC/FLOPは未推定、内部各層の時間は取得不可です。

### Qwen3の根拠と固定資産

確認日：2026-10-16。一次資料は次のとおりです。

- [Qwen公式のQwen3発表](https://qwenlm.github.io/blog/qwen3/)は119言語・方言の一覧に日本語を含めています。[Qwen3-0.6Bの上流モデルカード](https://huggingface.co/Qwen/Qwen3-0.6B)も多言語対応とApache-2.0を明記しています。
- [LiteRT変換物の固定リビジョン](https://huggingface.co/litert-community/Qwen3-0.6B/tree/e6687177e00897731e7716267eebd4eba0dde7c2)で Qwen3-0.6B_dynamic_wi4b32_afp32.litertlm を選択しました。Hugging Face APIで private:false / gated:false / Apache-2.0、およびLFSのサイズとSHA-256を確認しています。
- revision: e6687177e00897731e7716267eebd4eba0dde7c2
- ファイルサイズ: 344,671,744 bytes（表示は約345 MB。329 MiBとは単位が異なります）
- SHA-256: 03e7da1eb1108b50dffaa9bb52cc7bcbad2eb0c66ca990267f480c1e545d2856
- [Qwen上流のApache-2.0ライセンス](https://huggingface.co/Qwen/Qwen3-0.6B/blob/main/LICENSE)。認証・利用申請・新たな個別同意を要求しない公開ファイルから、無認証GETで実際に取得し、ファイル全体のSHA-256を検証しました。
- 固定URLのHTTP HEADでは、検証対象CDNの最終パスと Content-Length:344671744 / Access-Control-Allow-Origin:* を確認しました。これはブラウザでの取得成功を代替する証明ではありません。

配布カードのLiteRT-LM互換性記述は、Webでの動作保証ではありません。[SDK 0.18.0配布物](https://registry.npmjs.org/@litert-lm/core/0.18.0)のREADMEはGemma 4 E2B/E4Bのweb資産だけを掲載しています。一方、[更新される公式JSガイド](https://ai.google.dev/edge/litert-lm/js)はGemma 4のgpu資産を掲載しています。Qwenのこのファイルはどちらにも掲載されないため、実験的なCPU/WASM経路と表示しています。拡張子だけを根拠に対応済みとはしていません。

### 固定Workerによる日本語実行の確認

公開用にビルドした lm-worker.js をNode v24.19.0の最小ホストshimで読み、実際の initialize（modelId付き）→Worker SHA-256→loadLiteRtLm→Engine.create→createConversation→sendMessageStreaming→getBenchmarkInfo→Conversation.delete を通しました。SDKもモデルもモックではありません。ただしNodeのホストshimであり、ブラウザの表示・CORS・Worker起動・ネットワーク全体の検証とは区別します。

- CPU/XNNPACK単一スレッド、最大512トークン、TOP_P（k=1、p=1、temperature=1、seed=42）、出力上限32トークン。
- Qwenのみ preface.extra_context.enable_thinking:false を設定。初期表示の日本語入力例に /no_think などの追記はしていません。
- 初期表示の会議案内から、読める日本語の言い換えを生成。sendMessageStreamingは31.55秒、SDK decode13トークン、受信12チャンク。SDK TTFT25.70秒、Workerの初文字列受信31.55秒でした。
- Node側でモデルをArrayBufferに載せたこの試験のピークRSSは約2.76 GiB。先行のファイルストリームでSDKを直接動かした試験は約2.43 GiBでした。UIでは両者を参考範囲として表示します。どちらもブラウザ最低要件ではありません。
- 別の架空例では依頼の主体が変わる出力、一般知識では誤答を確認しました。日本語の動作確認は品質保証ではありません。

生の実行ログ・モデル本体・調査用ファイルは公開配布物に含めません。現在版の実ブラウザ確認結果はREADMEの最新の検証記録を参照してください。

### 公開Chromeでの日本語・モデル選択確認

2026-10-16、公開commit d2a1568141266e39c701cb699db97c2ec1d36ec1の共通生成タブで実操作しました。日本語Qwenが初期選択で、Smolへ変更すると言語・サイズ・参考メモリ・入力例が切り替わり、取得操作までは未読み込みでした。

Qwenの固定公式URL取得6.65秒、Main/Worker検証と初期化9.57秒の後、会議案内を自然な日本語へ言い換える応答を実生成しました。生成操作から完了30.48秒、SDK decode13トークン、実チャンク12、SDK TTFT24.32秒、Worker初文字列30.44秒でした。ほぼ完了時にまとめて受信しており、逐字アニメーションではありません。表示時間は1台の観測例です。

生成中にSmolへ切り替えると、Workerを終了する実装に従って未読み込み状態に戻り、結果・計測・確認チェックが消えました。Smolの明示取得と新規初期化後、英語応答を17.80秒で実生成。再度生成を開始して停止した場合は停止済みになり、生成ボタンが無効、完了したSDK値は表示しません。

Smol選択時にQwenファイルを指定するとサイズ不一致を拒否し、Qwenへ変更するとファイルは未選択に戻りました。固定QwenのローカルFileを選び直した経路では、読取0.27秒、検証・初期化8.59秒で準備できました。その後、30.18秒で日本語を再生成しました。モデル本体は端末内で読み、外部へアップロードする機能ではありません。

詳細な受入範囲とその後の停止・復帰はdocs/verification.mdを参照してください。生ログや応答の保存ファイルは公開しません。

以下は以前の英語版を検証した履歴です。現在版の実ブラウザ確認とは区別します。

---

# LiteRT-LM 英語生成実験

## 学習目標と業務へのつながり

CoreのTensor APIに対し、生成モデル用のEngine/Conversation APIがどの仕事を引き受けるかを比較します。架空の英語メモを整える例を使い、モデル取得と入力の推論、SDK内部のTTFTと画面への到着、token数とチャンク数を別々に観察します。生成文は不正確・不完全で、意味を変える場合もあります。判断や外部送信を自動化せず、人による確認を前提にします。

## 実モデル・実ランタイム

- @litert-lm/core 0.18.0 → LiteRT、CPU/XNNPACK。
- LLM側の@litertjs/wasm-utilsは2.0.0へscoped override。既存Core側は2.5.3のまま。
- SmolLM2_360M_instruct.litertlm、373,719,040 bytes。Apache-2.0、公開・ungated。
- revision: 507c99cfe6541ba2bcd84818786f7b025935e5e1。
- SHA-256: 8e2834da211b439751af968ed650febdde5a8cb8d88bc6c1a3059f049caa5c2e。
- Androidを対象とする配布物で、SDKの公式Web対応モデル一覧外。実験的なCPU組み合わせです。
- 日本語は実際の試験で文字化け・反復が出て利用不能でした。モデルだけの問題かデコード経路かは切り分けていません。英語ASCII入力だけを受け付けます。

## 実行の流れ

1. 注意事項の確認と明示操作。約374 MBのモデルを公式URLから取得、または同一モデルのローカルFileを選択。
2. 展開後の受信バイト数・SHA-256を検証。圧縮Content-Lengthを展開後サイズと比較しません。
3. ArrayBufferの所有権を専用Workerに移譲し、WorkerでもSHA-256を再検証。
4. SDKより先にWorkerの通信ガードを設定。指定したAsyncify/relaxed SIMDのloader/WASMを読み込む。
5. Engine.createをCPU・単一スレッド・最大512トークンで実行。
6. 毎回新しいConversationを作り、実証済みのTOP_P（k=1、p=1、temperature=1、seed=42）を使用。公開enumにあってもCPUのGREEDY/TOP_Kはこの版では未実装のため使いません。
7. sendMessageStreamingの実チャンクをtextContentで表示。架空の応答、HTML解釈、文字送り演出はありません。
8. SDKのgetBenchmarkInfo/getTokenCountと関数境界のwall-clockを分けて表示し、Conversation.delete。

SDK内部TTFTとMain/Workerが実際に文字列を受信した時間は異なります。Main受信はペイント時刻ではありません。チャンク数とtoken数を同一視しません。Node CPU試験では20チャンク/21decode tokens、初回チャンク約15秒、SDK TTFT約10.9秒となり、ほぼ終了時にまとまって到着しました。これはブラウザの性能を保証する値ではありません。

## メモリ・停止

Nodeの参考ピークは約2.7 GiB。ブラウザでも数GBの空きメモリがあるPCを想定し、モバイルを推奨しません。モデルはPages配布物やCoreオフライン保存に含めません。

停止はWorkerをterminateし、進行中のdownload fetchをabortします。MainのFile.arrayBuffer/SHA-256は中止できないため、終了まで次の読み込みを禁止し、待機状態を表示します。即時のOSメモリ回収は約束しません。再実行には新しいモデル初期化が必要です。エラー・画面移動・BFCache復帰は実行を無効化し、古い結果や時間を新しい入力に見せません。

## 通信境界

モデル取得は固定した公式URLへのGETだけです。Cookie・認証情報・追加ヘッダー・入力文は送信しません。配布先には通常のIP等の接続情報が伝わります。CSPは確認済みのhuggingface.coとus.aws.cdn.hf.coに制限し、最終origin/pathとダウンロード全体のSHA-256を確認します。ブラウザが管理する途中のredirectをJavaScriptから全て観測したとは主張しません。配布ルートが変わった場合はfail closedで再確認します。

WorkerはimportScriptsに渡すローダーの要求URLを固定しています。importScripts自体のリダイレクト先はこのコードから検証できないため、同一オリジンの配信コードを信頼する前提です。公開先では2026-10-13にHTTP HEADでloader/WASMが同じURLから200・リダイレクトなしで配信されることを確認しました。これはブラウザ全通信の捕捉ではありません。Workerがdocument CSPを継承するとは仮定しません。WASM取得はredirect:error、credentials:omit。読み込み後はfetch/importScriptsのガードを閉じ、XHR/WebSocket等の不要な通信も拒否します。

コード監査・隔離したCPU試験では、この固定LM SDKのテレメトリを検出していません。これはブラウザ全体や拡張機能の保証ではありません。実ブラウザ検証状況はREADMEに記載します。入力は診断ログ・永続保存・履歴に記録しません。テスト用例はすべてこの教材のために作成した架空の英語文です。

## 一次資料

- https://developers.google.com/edge/litert-lm/js
- https://github.com/google-ai-edge/LiteRT-LM/tree/main/js
- https://registry.npmjs.org/@litert-lm/core/0.18.0
- https://huggingface.co/litert-community/SmolLM2-360M-Instruct/tree/507c99cfe6541ba2bcd84818786f7b025935e5e1

## 既存Coreオフライン機能との関係

Service Workerがないページはそのまま利用できます。制御がある場合は、同じリポジトリrootのsw.js・scope・activeオブジェクトの一致・activated状態・現controllerの一致と、最大2秒のMessageChannelによる明示的な配信ポリシーバージョン応答を確認します。旧版・未知の制御・タイムアウトは拒否します。markerは互換性確認で、実行中のスクリプトバイトの認証ではありません。

検証待ちに制御や実行epochが変わった場合、遅れて成功しても有効化しません。読込開始・生成・初期化メッセージ送信直前にも同期確認します。controllerchangeではモデルを停止し、再読み込みを要求します。アプリから新規SW登録や設定変更はしません。root SWは追加実験のキャッシュを迂回し、redirect:error/credentials:omit/no-referrerで取得します。既存SW管理下の実ブラウザ試験は別途必要です。

## 公開Chromeで確認したこと · 2026-10-13

commit 6c966bb169b6a1c36228225786ab96925363bdcd の https://check5004.github.io/litert-explorer/generation/ をクラウドChrome 154（Linux）で実操作しました。モデルは同梱せず、確認チェックと取得ボタンを押して、公式配布先からのCORS取得・サイズ・Main/WorkerのSHA-256検証を経て初期化しました。

- 架空の問い合わせ文から本物の英語応答を生成。sendMessageStreamingは16.63秒、Main到着16.66秒、SDK内部TTFT11.75秒、SDK decode21 tokens、受信20チャンク。文章は一文指示を守らず意味も変えており、品質が保証されないことを確認しました。
- 同じEngineで別の架空の短文を実行。11.91秒、SDK decode6 tokens、受信5チャンク。毎回新しいConversationを使用します。この異なる入力同士を純粋なcold/warm速度比較とは扱いません。
- 入力変更時に旧出力・生成計測が消えること、空入力・日本語を拒否し架空の回答を表示しないことを確認。
- sendMessageStreamingが実行中の状態で停止し、Worker破棄・中断表示・SDK完了値なし・生成ボタン無効を確認。経過時間は中断までの実時間で、成功した推論時間ではありません。
- 明示的なモデル再取得（60.11秒）と新規Worker/Engine初期化後に、20.08秒・40 SDK decode tokensの本物の応答を生成。40トークンの上限で文章が途中になりました。モデル解放後は未読み込み状態に戻り、生成ボタンが無効になることも確認。

モデルの初回取得は65.77秒でしたが、通信状況に依存します。これらは1台の実測例で、性能保証ではありません。ブラウザ全体のパケット取得、既存SW管理下、ローカルモデルFile経路、オフライン、モバイル・Safari・Firefox、実メモリ解放量は確認していません。SDKの利用や配信処理に由来するエラーは確認した対象ログには見つかりませんでしたが、これは全通信の不存在の証明ではありません。生の入力・応答・実行ログは公開リポジトリに含めません。

## 共通タブでのライフサイクル

mountGenerationはShadowRoot内の操作部を設置するだけです。共通シェルは初回タブ選択時に操作部を遅延ロードし、SDKやモデルの取得は確認チェックと取得操作まで行いません。通信はシェルの固定URLガードとWorkerの独立ガードで制限します。タブ離脱はモデル/Worker/進行中取得を破棄し、結果・計測・確認チェックをリセットします。中止不能なMainの読取/ハッシュが残る場合も、終了までは再取得できません。従来のgeneration/リンクは共通画面の#generationへ移動します。
