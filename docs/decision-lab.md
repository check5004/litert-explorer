# 問い合わせの意味で振り分ける

この教材は、低水準の Tensor API と高水準の Tasks API の違いを学ぶ追加実験です。5件の固定文は、このアプリのために作成した架空の問い合わせです。利用者の会話・会社の問い合わせ履歴から転載していません。

## 実行経路

MediaPipe Tasks Decision Maker 1.1.0 → LiteRT-LM → LiteRT。EmbeddingGemma 2 Text 270M の学習済み表現を使う意味スコアリングです。問い合わせ分類専用に学習された decision head や、生成された思考過程とは説明しません。

1. ボタン操作で Blob module Worker を開始。
2. SDKより先に、正確な同一オリジン資産URLだけを許可する通信ガードを設定。
3. FilesetResolverでローカルWASMを解決。
4. モデルを取得。既知の展開後サイズ164,626,432 bytesとSHA-256を照合。
5. CPU指定のcreateFromOptionsでモデルを初期化。
6. 公式サンプルのバージョン固有Promise互換処理を適用。
7. evaluateChoiceに架空文と4候補の日本語説明を渡す。
8. selectedKey、probabilities、confidenceを未加工で表示。

各関数のperformance.now()差分は実測wall-clockです。SDK内部のトークン化・埋め込み生成・類似度処理の個別時間や内部テンソルを公開APIから取得したとは扱いません。初回と同じWorkerでの再実行を区別します。

## 社内共有で試す問い

- 単語が同じかではなく、説明文との意味の近さを使うと何が変わるか。
- 複数の要件が混じった問い合わせを、人に確認してもらうには何を表示すべきか。
- SDKの相対スコアを実世界の正答率と誤解すると、どんな運用リスクがあるか。
- 自動振り分け前の候補提示を端末内で行うなら、どのデータを端末の外に出す必要がなくなるか。

本アプリは担当者の決定、業務システムへの転送、優先度の自動判断はしません。少数の例で本番精度・校正・公平性を証明したものでもありません。

## 通信・保存・制約

SDKにはGoogleへの利用指標POSTが含まれます。サポートされたオプトアウトはなく、このアプリはfetch/XHR等のガードで転送前に拒否し、Blob Workerは共通シェルのCSPを継承します。共通CSPにはLLMモデル用のHF/CDN許可がありますが、DecisionはSDK前の完全一致許可リストで独立に通信を制限します。通信ログに本文・ヘッダー・APIキーは含めません。アプリのガードは悪意ある同一オリジンコードやブラウザ拡張に対するセキュリティ境界ではありません。

Core実験のオフライン保存対象にはDecision資産を含めません。既知のroot sw.jsによる制御だけを許可し、controllerchangeではWorkerを終了して再初期化を要求します。追加タブの資産のSW経由GETはredirect:errorです。初期化・推論中の中止はWorkerの強制終了で、SDKのclose()完了とは区別します。

SHA-256照合のため157 MiBのJSバッファを保持し、さらにランタイムがメモリを使います。モバイルを推奨しません。Node実推論・単体テストに加え、公開PagesのChromeで実出力、推論中止と復帰、自然な60秒後と新規Workerのclose時の送信遮断を確認しました。全ブラウザ・Service Worker管理下を検証したものではありません。範囲はREADMEを参照してください。

## 一次資料

- https://developers.google.com/edge/mediapipe/solutions/decision/decision_maker/web_js
- https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/decision-maker.worker.ts
- https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm/tree/9be6e8b90982095dc05c2bd162e4b954ee4dbac7
- https://developers.google.com/edge/mediapipe/solutions/tasks#mediapipe_tasks_privacy_notice
- https://github.com/google-ai-edge/mediapipe/issues/6306
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy

## 共通タブでのライフサイクル

mountDecisionはShadowRoot内に操作部だけを設置し、初期化はボタン操作まで実行しません。タブ切り替えはWorker終了・Blob URL解放・時計停止を同期的に行い、古い応答を無視します。未完了の推論はN/Aとして表示し、終了済みの実測値だけを履歴として残します。強制終了をclose成功とは扱いません。再表示しても明示的な再初期化が必要です。
