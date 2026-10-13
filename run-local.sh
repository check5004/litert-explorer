#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
echo 'LiteRT Lab: 初回は公開モデル約484 MB + tokenizer/WASM等を取得します。入力データの送信はありません。'
npm ci --ignore-scripts
npm run assets
npm run build
npm run preview
