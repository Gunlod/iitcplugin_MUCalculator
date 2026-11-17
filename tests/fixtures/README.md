# IITC標準ダイアログのテスト用ソース

`iitc-dialog.js` と `iitc-dialog.css` はIITC-CEの公式ソースを変更せず保存したものです。

- 元ソース：[core/code/dialog.js](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/core/code/dialog.js)
- 標準スタイル：[core/styles/dialogs.css](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/core/styles/dialogs.css)
- コミット：`58ba3a7a39d6aee1efc2352965ce25054adce47f`
- ライセンス：同梱の `LICENSE.iitc`

ブラウザテストではjQuery UIと組み合わせ、標準タイトルバー・最小化・閉じる処理を実行します。Intel Mapの地図背景・テーマ変数・ポータルデータ・API応答はテスト用です。専用ダイアログ向けのCSSインポート4件は対象外のため空で応答します。プラグイン本体には同梱・注入しません。
