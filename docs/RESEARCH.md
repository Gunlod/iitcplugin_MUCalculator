# 公式実装とAPIの調査

調査日：2026-11-17。作業開始時のディレクトリは空で、既存実装・AGENTS.md・Git管理はありませんでした。

IITC-CEのGitHub `master` を調査しました。取得したツリーのコミットは `58ba3a7a39d6aee1efc2352965ce25054adce47f` です。以下はそのコミットへの固定リンクです。

| 調査対象 | 確認した契約と実装への反映 |
|---|---|
| [pluginwrapper.py](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/pluginwrapper.py) | `wrapper(plugin_info)`、window.plugin、bootPlugins、iitcLoadedでの即時setup。注入末尾を標準形式に揃えた |
| [IITC_FileManager.java](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/mobile/app/src/main/java/org/exarhteam/iitc_mobile/IITC_FileManager.java) | Androidは標準の注入末尾文字列を `wrapper(info);` に置換。変換後コードをブラウザテストでも実行 |
| [IITC_PluginManager.java](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/mobile/app/src/main/java/org/exarhteam/iitc_mobile/IITC_PluginManager.java) | ユーザープラグイン・開発用 `.user.js` のメタデータ読込を確認 |
| [portal_display.js](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/core/code/portal_display.js) | portalSelectedは `selectedPortalGuid` を渡す。window.portalsのmarkerから座標・options.data.titleを読む。既存の選択処理を置き換えない |
| [draw-tools.js](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/plugins/draw-tools.js) | Draw Tools 0.13.0。`plugin.drawTools.drawnItems` はFeatureGroup。eachLayer、Leafletの型とgetLatLngsでスナップショットを作る。serializeLayerの型判定も確認。save・import・clearLayersには触れない |
| [dialog.js](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/core/code/dialog.js) | 標準window.dialogはDOMのhtml、id、width、modal、closeCallbackを受ける。冒頭注釈にはモバイルでmodalがtrueになるとあるが、現行関数本体の既定値はfalse。Androidでは地図領域を確保しやすい独立した下部パネルを使用 |
| [panes.js](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/core/code/panes.js) / [smartphone.js](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/core/code/smartphone.js) | `window.show('map')` と `paneChanged` を確認。ポータル選択ごとの画面切替を行わない |
| [toolbox.js](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/core/code/toolbox.js) | `IITC.toolbox.addButton({id,label,action})` を優先し、旧ToolboxへのDOM追加をフォールバックとして用意 |
| [utils_file.js](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/core/code/utils_file.js) | `IITC.utils.exportFile(data,filename,dataType)` はAndroidでは `app.saveFile(filename,dataType,data)` に渡す。ファイル選択はFileReaderに対応 |
| [IITC_Mobile.java](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/mobile/app/src/main/java/org/exarhteam/iitc_mobile/IITC_Mobile.java) | 戻る操作はアプリのダイアログ／画面スタックで処理。存在しない戻るイベントを想定せず、ネイティブ処理を維持 |
| [IITC_WebChromeClient.java](https://github.com/IITC-CE/ingress-intel-total-conversion/blob/58ba3a7a39d6aee1efc2352965ce25054adce47f/mobile/app/src/main/java/org/exarhteam/iitc_mobile/IITC_WebChromeClient.java) | HTMLのファイル選択に対応するonShowFileChooserを確認 |

## MU API

[公式APIドキュメント](https://mu.investigatexm.com/api.html) のHTMLを取得して確認しました。Web検索ツール経由では取得できなかったため、HTTPSによる直接取得を使用しました。

確認した仕様は、6桁へのhalf-up丸め、球面三角形、単一計算、bulkのトップレベルmodelとresultsごとのindex・id・ok、50件・32,768バイト・20秒制限、healthのmodel、非JSONのCDN応答です。レスポンスのcoordinatesは6桁の「緯度, 経度」文字列配列です。

ブラウザのUser-Agentは指定せず、認証情報も送信しません。任意のNode.jsライブテストは通常のHTTPクライアントとして識別用User-Agentを送信します。これはブラウザ版の通信経路とは別です。

2026-11-17の実API確認結果：

- `/health`：ok=true、モデル `grump2000-s2java2011-min6-l6min1`
- 公式例の3座標：3,046 MU、16.311625962717194 km²
- bulkで有効CFのok=trueと重複座標CFのok=falseを確認
- Intel Map Originに対するOPTIONS応答の `Access-Control-Allow-Origin: *` を確認

モデル名・計算値はこの調査時点の観測値です。実装には固定のモデル名・MU値を埋め込んでいません。
