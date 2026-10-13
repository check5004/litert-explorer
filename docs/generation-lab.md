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
