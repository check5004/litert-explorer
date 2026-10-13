#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
echo 'LiteRT Lab: 初回は公開モデルCore・Decision・LLMランタイム用資産 合計約764 MBを取得します。入力データの送信はありません。'
npm ci --ignore-scripts
npm run assets
npm run build
npm run preview
