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

## 実ブラウザでは別途確認が必要

NodeのSDK試験とソースレビューだけで、次の項目をPASSとは扱いません。

- 初期表示、レイアウト、レスポンシブ
- ブラウザWorkerからのWASM初期化と初回モデル取得
- 繰り返し、中止、再実行、画像選択、破損画像、メモリ解放
- 実際のリクエストを捕捉した送信先の検証
- Service Workerへの大容量保存、容量不足、オフライン再読み込み
- Safari、Firefox、モバイルでの互換性

実ブラウザが使える環境で npm run preview を起動し、CHROMIUM_PATHを指定して npm run test:browser を実行できます。tests/browser.mjsにはこれらのフローを検証するコードがありますが、テストコードの存在は実行成功の証明ではありません。公開URLでの実推論を確認するまではブラウザ受け入れ試験は完了していません。
