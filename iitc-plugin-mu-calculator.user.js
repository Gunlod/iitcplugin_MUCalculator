// ==UserScript==
// @id             iitc-plugin-mu-calculator
// @name           IITC plugin: MU Calculator
// @category       Layer
// @version        1.0.3
// @namespace      iitc.plugin.mu-calculator
// @description    Estimate MU for portal selections and Draw Tools fields
// @match          https://intel.ingress.com/*
// @match          https://intel-x.ingress.com/*
// @grant          none
// ==/UserScript==

/**
 * IITCのページ内にプラグインを登録する。
 * @param {Object} plugin_info スクリプト情報。
 * @returns {Object|undefined} テスト時のみ共通処理を返す。
 */
function wrapper(plugin_info) {
  'use strict';

  // Androidを含め、実行時処理をIITCラッパー内へまとめる。
  /**
   * 画面に依存しないデータ管理・通信・検出処理を生成する。
   * @returns {Object} 共通処理の公開インターフェース。
   */
  function createCore() {
    const VERSION = 1;
    const API = 'https://api.investigatexm.com';
    /**
     * 描画や入力処理へ制御を戻す。
     * @returns {Promise<void>} 次のイベントループで完了する待機。
     */
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    /**
     * 指定したメッセージで処理を失敗させる。
     * @param {string} message エラー内容。
     * @throws {Error} 検証または処理の失敗。
     */
    function fail(message) { throw new Error(message); }
    // APIと同じ丸め規則に揃える。
    /**
     * 座標を小数6桁へ四捨五入する（負数の中間値はゼロから遠ざける）。
     * @param {number} value 丸める数値。
     * @returns {number} API精度に揃えた数値。
     */
    function round6(value) {
      const number = Number(value);
      // 有限でない数値は座標として受け付けない。
      if (!Number.isFinite(number)) fail('座標は有限の数値で指定してください。');
      const parts = Math.abs(number).toString().toLowerCase().split('e');
      const digits = parts[0].split('.');
      const exponent = Number(parts[1] || 0) - (digits[1] || '').length + 6;
      let s = (digits[0] + (digits[1] || '')).replace(/^0+/, '') || '0';
      let integer;
      // 桁を増やす場合は整数として補い、減らす場合は端数を丸める。
      if (exponent >= 0) integer = Number(s) * Math.pow(10, exponent);
      else {
        const cut = s.length + exponent;
        // 残す整数桁がなければゼロを基準に丸める。
        integer = cut > 0 ? Number(s.slice(0, cut)) : 0;
        // 捨てる桁が5以上なら絶対値を切り上げる。
        if (cut >= 0 && Number(s[cut]) >= 5) integer++;
      }
      // 丸めた絶対値へ元の符号を戻す。
      return (number < 0 ? -integer : integer) / 1e6 || 0;
    }
    /**
     * 座標を検証し、比較用の頂点情報へ正規化する。
     * @param {Object} p 緯度・経度と任意のGUID・名前。
     * @returns {Object} 正規化した頂点。
     */
    function point(p) {
      // 数値以外・非有限値・範囲外の座標を拒否する。
      if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number' ||
          !Number.isFinite(p.lat) || !Number.isFinite(p.lng) ||
          Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) fail('緯度・経度が無効です。');
      let lat = round6(p.lat), lng = round6(p.lng);
      // 日付変更線の同一点を経度-180へ統一する。
      if (lng === 180) lng = -180;
      // 極では経度による座標の違いをなくす。
      if (Math.abs(lat) === 90) lng = 0;
      // GUID・名前は文字列だけを採用する。
      return {lat, lng, guid: typeof p.guid === 'string' ? p.guid : '', name: typeof p.name === 'string' ? p.name : ''};
    }
    /** 頂点からAPI送信用の緯度・経度だけを取り出す。 */
    const coord = p => ({lat: p.lat, lng: p.lng});
    /** 正規化済み頂点の座標キーを作る。 */
    const pointKey = p => p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
    /** 頂点順序に依存しないCFの座標キーを作る。 */
    const fieldKey = vertices => vertices.map(pointKey).sort().join('|');
    /** 緯度・経度を単位球面上の3次元ベクトルへ変換する。 */
    function vector(p) {
      const lat = p.lat * Math.PI / 180, lng = p.lng * Math.PI / 180;
      return [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)];
    }
    /** ベクトルの各成分を掛け合わせ、内積を求める。 */
    const dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0);
    /** 2つの3次元ベクトルの外積を求める。 */
    const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    /**
     * 3頂点が計算可能な球面三角形か検証する。
     * @param {Object[]} raw 未正規化の3頂点。
     * @returns {Object[]} 検証済みの3頂点。
     * @throws {Error} 重複頂点・対蹠辺・面積ゼロの場合。
     */
    function triangle(raw) {
      // 頂点数が3でない入力を拒否する。
      if (!Array.isArray(raw) || raw.length !== 3) fail('CFには3頂点が必要です。');
      const vertices = raw.map(point);
      // API精度に丸めた後の重複頂点を拒否する。
      if (new Set(vertices.map(pointKey)).size !== 3) fail('6桁精度で重複する頂点があります。');
      const [a,b,c] = vertices.map(vector);
      // 大円の辺を一意に決められない対蹠点を拒否する。
      if ([dot(a,b),dot(b,c),dot(c,a)].some(x => x < -1 + 1e-14)) fail('対蹠点間の辺は扱えません。');
      const ab = b.map((x,i) => x-a[i]), ac = c.map((x,i) => x-a[i]);
      const normal = cross(ab, ac), determinant = Math.abs(dot(a, normal));
      // 浮動小数点誤差を考慮して面積ゼロを除外する。
      if (determinant <= Math.max(1e-24,16*Number.EPSILON*Math.hypot(...normal))) fail('球面上で面積ゼロの三角形です。');
      return vertices;
    }
    /**
     * MU・面積・モデルが有効な計算結果か判定する。
     * @returns {boolean} 集計に利用できる場合はtrue。
     */
    function validResult(r) {
      return !!r && Number.isSafeInteger(r.mu) && r.mu >= 0 &&
        typeof r.area_km2 === 'number' && Number.isFinite(r.area_km2) && r.area_km2 > 0 &&
        typeof r.model === 'string' && r.model.length > 0;
    }
    class Store {
      /** CF・選択頂点・キャッシュと重複判定用の索引を初期化する。 */
      constructor() {
        this.fields = []; this.selection = []; this.mode = 'single'; this.nextId = 1;
        this.highlight = ''; this.cache = Object.create(null);
        this.byKey = new Map(); this.byGuid = new Set();
      }
      /**
       * 重複しないCFを登録する。
       * @param {Object[]} raw 登録する3頂点。
       * @param {string} source ポータル選択またはDraw Toolsの区分。
       * @returns {Object|null} 登録したCF。重複時はnull。
       */
      add(raw, source = 'portal') {
        const vertices = triangle(raw), key = fieldKey(vertices);
        // 全頂点のGUIDが揃う場合だけGUIDキーを作る。
        const guids = vertices.every(v => v.guid) ? vertices.map(v => v.guid).sort().join('|') : '';
        // 座標またはGUIDの組み合わせが登録済みなら追加しない。
        if (this.byKey.has(key) || (guids && this.byGuid.has(guids))) return null;
        const f = {id: 'CF' + this.nextId++, key, vertices, source, visible: true,
          color: ['#ffb347','#39c5ef','#db82ff','#75e291','#ff789d'][this.fields.length % 5], status: 'pending', result: null, error: ''};
        this.fields.push(f); this.byKey.set(key,f); /* GUIDが揃うCFだけGUID索引にも登録する。 */ if (guids) this.byGuid.add(guids); return f;
      }
      /**
       * 選択モードに従って頂点を追加し、3頂点からCFを登録する。
       * @param {Object} raw 選択されたポータル。
       * @returns {Object} 登録したCFと表示メッセージ。
       */
      select(raw) {
        const v = point(raw);
        // 同じポータルの再選択を無視する。
        if (this.selection.some(p => (v.guid && p.guid === v.guid) || pointKey(p) === pointKey(v))) return {message:'選択済みのポータルです。'};
        // 単一CFの次の選択では前回の頂点を空にする。
        if (this.mode === 'single' && this.selection.length === 3) this.selection = [];
        this.selection.push(v);
        // 3頂点が揃うまではCFを作らない。
        if (this.selection.length < 3) return {};
        let f;
        try { /* 共通辺モードではA・Bを固定して最新のCを組み合わせる。 */ f = this.add(this.mode === 'edge' ? [this.selection[0],this.selection[1],v] : this.selection); }
        catch (e) { this.selection.pop(); throw e; }
        // 自由選択では次のCF用に頂点を空にする。
        if (this.mode === 'free') this.selection = [];
        // 新規登録と重複をメッセージで区別する。
        return {field: f, message: f ? f.id + ' を登録しました。' : '同じCFは登録済みです。'};
      }
      /**
       * 指定CFとその重複判定用索引を削除する。
       * @param {string} id 削除するCF番号。
       */
      remove(id) {
        const f = this.fields.find(f => f.id === id);
        // 対象CFがあれば関連索引も取り除く。
        if (f) { this.byKey.delete(f.key); this.byGuid.delete(f.vertices.map(v => v.guid).sort().join('|')); }
        this.fields = this.fields.filter(f => f.id !== id); /* 削除したCFの強調状態を解除する。 */ if (this.highlight === id) this.highlight = '';
        // 全CFを削除した後の新規登録はCF1から再開する。
        if (!this.fields.length) this.nextId = 1;
      }
      /** 登録CF・選択頂点・キャッシュ・索引を全て初期化する。 */
      clear() { this.fields = []; this.selection = []; this.cache = Object.create(null); this.highlight = ''; this.nextId = 1; this.byKey.clear(); this.byGuid.clear(); }
      /**
       * 成功したCFだけからMU・面積・件数を集計する。
       * @returns {Object} 合計値と成功・失敗・未完了の情報。
       */
      summary() {
        const good = this.fields.filter(f => f.status === 'success' && validResult(f.result));
        return {count:this.fields.length, success:good.length, failed:this.fields.filter(f => f.status === 'error').length,
          mu:good.reduce((n,f) => n+f.result.mu,0), area:good.reduce((n,f) => n+f.result.area_km2,0),
          models:[...new Set(good.map(f => f.result.model))], partial:good.length !== this.fields.length};
      }
      /** 保存・JSON出力用にスキーマ付きデータを返す。 */
      export() { return {schemaVersion:VERSION, exportedAt:new Date().toISOString(), mode:this.mode,
        selection:this.selection, fields:this.fields, highlight:this.highlight, cache:this.cache}; }
      /**
       * 保存データを検証し、新しいストアとして復元する。
       * @param {Object} data 保存またはインポートしたJSONデータ。
       * @returns {Store} 検証済みのストア。
       * @throws {Error} 形式・バージョン・頂点が不正な場合。
       */
      static parse(data) {
        // 未対応スキーマや不正な一覧は復元しない。
        if (!data || data.schemaVersion !== VERSION || !Array.isArray(data.fields)) fail('対応していないJSON形式・スキーマバージョンです。');
        const s = new Store();
        // 定義済みのモードだけを復元する。
        if (['single','edge','free'].includes(data.mode)) s.mode = data.mode;
        const ids = new Set();
        // 保存されたCFを検証しながら順に復元する。
        for (const raw of data.fields) {
          // 保存元の区分はDraw Toolsかポータルに限定する。
          const f = s.add(raw.vertices, raw.source === 'draw' ? 'draw' : 'portal');
          // 重複CFは読み飛ばす。
          if (!f) continue;
          // 形式が正しく未使用のCF番号を引き継ぐ。
          if (typeof raw.id === 'string' && /^CF[1-9]\d{0,9}$/.test(raw.id) && !ids.has(raw.id)) f.id = raw.id;
          // 番号が重複しなくなるまで採番を進める。
          while (ids.has(f.id)) f.id = 'CF'+s.nextId++;
          ids.add(f.id); s.nextId = Math.max(s.nextId,Number(f.id.slice(2))+1);
          f.visible = raw.visible !== false;
          // 6桁のカラーコードだけを復元する。
          if (/^#[0-9a-f]{6}$/i.test(raw.color)) f.color = raw.color;
          // 有効な過去結果は参考値とし、保存された失敗状態とは区別する。
          if (validResult(raw.result)) { f.result = {...raw.result}; f.status = 'stale'; }
          else /* 失敗CFには前回のエラーを引き継ぐ。 */ if (raw.status === 'error') { f.status = 'error'; f.error = String(raw.error || '計算失敗'); }
        }
        // 選択頂点が配列なら正規化し、重複を除いて復元する。
        if (Array.isArray(data.selection)) s.selection = data.selection.map(point).filter((v,i,a) => a.findIndex(p => pointKey(p) === pointKey(v) || (v.guid && p.guid === v.guid)) === i);
        // 共通辺モード以外の過剰な選択頂点を拒否する。
        if (s.mode !== 'edge' && s.selection.length > 3) fail('選択データが無効です。');
        // 存在するCFだけ強調状態を復元する。
        if (s.fields.some(f => f.id === data.highlight)) s.highlight = data.highlight;
        // 現在のモデルをhealthで確認するまで、保存キャッシュは確定値にしない。
        // 復元した各CFの参考値をキャッシュへ登録する。
        for (const f of s.fields) /* 有効な参考値だけをキャッシュ候補に残す。 */ if (validResult(f.result)) s.cache[f.key] = f.result;
        // 保存キャッシュがオブジェクトの場合だけ読み込む。
        if (data.cache && typeof data.cache === 'object') /* 保存されたキャッシュをキーごとに検証する。 */ for (const [key,r] of Object.entries(data.cache)) {
          // 計算結果として有効なキャッシュだけを取り込む。
          if (validResult(r)) s.cache[key] = {...r};
        }
        return s;
      }
    }
    /** 文字列をUTF-8で送信した場合のバイト数を求める。 */
    function bytes(text) {
      // 標準のUTF-8エンコーダーを優先し、未対応時は互換処理を使う。
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
      return unescape(encodeURIComponent(text)).length;
    }
    /** CFごとの座標と番号からbulk用のJSON本文を作る。 */
    const bulkBody = fields => JSON.stringify({fields:fields.map(f => ({id:f.id, coordinates:f.vertices.map(coord)})), detail:false});
    /**
     * CF数とUTF-8本文サイズの上限に従ってリクエストを分割する。
     * @param {Object[]} fields 計算するCF一覧。
     * @param {number} maxBytes 本文の最大バイト数。
     * @returns {Object[][]} 順次送信するCFのまとまり。
     */
    function batches(fields, maxBytes = 32768) {
      const chunks = []; let chunk = [];
      // CFを順に詰め、送信単位の上限を守る。
      for (const f of fields) {
        // 1CFだけで本文上限を超える場合は分割できないため拒否する。
        if (bytes(bulkBody([f])) > maxBytes) fail('1CFのリクエストがバイト数上限を超えます。');
        // 件数または本文サイズが上限に達する前に次のまとまりへ分ける。
        if (chunk.length === 50 || bytes(bulkBody(chunk.concat(f))) > maxBytes) { chunks.push(chunk); chunk = []; }
        chunk.push(f);
      }
      // 最後に残ったCFも送信対象へ加える。
      if (chunk.length) chunks.push(chunk);
      return chunks;
    }
    /** 非同期処理で共有するキャンセル状態を作る。 */
    function token() {
      return {cancelled:false, handlers:new Set(), /** キャンセル状態に切り替え、登録した中断処理を呼び出す。 */ cancel() { this.cancelled = true; /* 登録済みの通信中断処理を全て呼ぶ。 */ for (const fn of this.handlers) fn(); }};
    }
    /** 通常の通信失敗と識別できるキャンセル例外を作る。 */
    function cancelled() { const e = new Error('キャンセルしました。'); e.cancelled = true; return e; }
    /**
     * APIへ通信し、JSON応答を取得する。
     * @param {string} path APIのパス。
     * @param {string|undefined} body POST本文。省略時はGET。
     * @param {Object} job キャンセル状態。
     * @param {Object} env 通信APIを提供する実行環境。
     * @param {number} timeout 待機上限のミリ秒。
     * @returns {Promise<Object>} 解析済みJSON。
     */
    async function request(path, body, job, env = globalThis, timeout = 25000) {
      // 送信開始前にキャンセルを確認する。
      if (job.cancelled) throw cancelled();
      // 本文の有無でGETとPOSTを切り替える。
      const method = body === undefined ? 'GET' : 'POST';
      // 中断可能なfetchが使える場合は優先する。
      if (typeof env.fetch === 'function' && typeof env.AbortController === 'function') {
        const controller = new env.AbortController(); let timedOut = false;
        /** fetchの進行中リクエストを中断する。 */
        const stop = () => controller.abort(); job.handlers.add(stop);
        const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
        try {
          // POSTの場合だけJSONヘッダーを付ける。
          const response = await env.fetch(API+path, {method, body, headers:body === undefined ? {} : {'Content-Type':'application/json'}, signal:controller.signal, credentials:'omit', cache:'no-store'});
          const text = await response.text();
          // 応答取得中にキャンセルされた場合は結果を使わない。
          if (job.cancelled) throw cancelled();
          // HTTP失敗はAPIの詳細メッセージを添えて通知する。
          if (!response.ok) {
            let detail = ''; try { detail = JSON.parse(text).error || ''; } catch (_) { /* CDNが返すHTMLなどはエラー詳細として解析しない。 */ }
            // APIのエラー詳細がなければ一般的な応答エラーを表示する。
            fail('HTTP '+response.status+(detail ? ': '+detail : '（API・ネットワーク応答）'));
          }
          try { return JSON.parse(text); } catch (_) { fail('APIからJSON以外の応答が返されました。'); }
        } catch (e) {
          // 通信失敗とユーザーによる中断を区別する。
          if (job.cancelled) throw cancelled();
          // 待機上限による中断をタイムアウトとして通知する。
          if (timedOut) fail('通信がタイムアウトしました。');
          // 接続失敗はネットワーク・CORSの確認を案内する。
          if (e instanceof TypeError) fail('APIに接続できません（ネットワーク・CORSを確認）。');
          throw e;
        } finally { clearTimeout(timer); job.handlers.delete(stop); }
      }
      // 古いWebViewはXHRへ切り替え、CORSの制約は維持する。
      return new Promise((resolve,reject) => {
        const xhr = new env.XMLHttpRequest();
        /** XHRを中断し、キャンセルとして通知する。 */
        const stop = () => { xhr.abort(); reject(cancelled()); };
        job.handlers.add(stop);
        /** XHR完了時に中断ハンドラーを解除して結果を通知する関数を作る。 */
        const finish = fn => value => { job.handlers.delete(stop); fn(value); };
        const bad = finish(reject), good = finish(resolve);
        xhr.open(method, API+path); xhr.timeout = timeout;
        // POST本文がある場合だけJSONヘッダーを設定する。
        if (body !== undefined) xhr.setRequestHeader('Content-Type','application/json');
        /** XHRのHTTP状態とJSON応答を検証する。 */
        xhr.onload = () => {
          // XHRでもキャンセル済みの応答を破棄する。
          if (job.cancelled) return bad(cancelled());
          // 成功以外のHTTP状態をエラーにする。
          if (xhr.status < 200 || xhr.status >= 300) return bad(new Error('HTTP '+xhr.status));
          try { good(JSON.parse(xhr.responseText)); } catch (_) { bad(new Error('APIからJSON以外の応答が返されました。')); }
        };
        /** XHRのネットワーク・CORS失敗を通知する。 */
        xhr.onerror = () => bad(new Error('APIに接続できません（ネットワーク・CORS）。'));
        /** XHRの待機上限超過を通知する。 */
        xhr.ontimeout = () => bad(new Error('通信がタイムアウトしました。'));
        /** XHRの中断をキャンセルとして通知する。 */
        xhr.onabort = () => bad(cancelled());
        try { xhr.send(body); } catch (e) { bad(e); }
      });
    }
    /**
     * モデル確認後にキャッシュと順次API通信でCFを計算する。
     * @param {Store} store 計算対象とキャッシュ。
     * @param {Object} job キャンセル状態。
     * @param {Function} transport API通信処理。
     * @param {Function} progress 完了数と総数の通知先。
     * @returns {Promise<void>} 全対象の処理完了。
     */
    async function calculate(store, job, transport = request, progress = () => {}) {
      const snapshot = store.fields.slice(); let done = 0, currentModel = null;
      // モデル確認前の保存結果は集計に使わない。
      // 全対象を未計算へ戻し、前回のエラー表示を消す。
      snapshot.forEach(f => { f.status = 'pending'; f.error = ''; }); progress(0,snapshot.length);
      try {
        try {
          const health = await transport('/health', undefined, job);
          // 稼働中のAPIが返した有効なモデル名だけを採用する。
          if (health.ok === true && typeof health.model === 'string' && health.model) currentModel = health.model;
        } catch (e) { /* キャンセルは中止し、healthの通信失敗だけなら新規計算へ進む。 */ if (job.cancelled || e.cancelled) throw e; /* healthに接続できなければキャッシュを使わず計算する。 */ }
        // モデル確認中のキャンセルを反映する。
        if (job.cancelled) throw cancelled();
        const pending = [];
        // 各CFについて現在のモデルとキャッシュを照合する。
        for (const f of snapshot) {
          const cached = store.cache[f.key];
          // 現在のモデルと一致するキャッシュだけを利用する。
          if (currentModel && validResult(cached) && cached.model === currentModel) {
            f.result = {...cached}; f.status = 'success'; done++;
          } else { f.result = null; pending.push(f); }
        }
        progress(done,snapshot.length);
        // APIへの過剰な並列送信を避け、分割単位で順に計算する。
        for (const chunk of batches(pending)) {
          // 次の分割リクエストを送る前に中断を確認する。
          if (job.cancelled) throw cancelled();
          // 今回送信するCFだけを計算中にする。
          chunk.forEach(f => f.status = 'running'); progress(done,snapshot.length);
          try {
            const single = pending.length === 1;
            // 計算対象が1件なら単一API、それ以外はbulk形式を使う。
            const response = await transport(single ? '/getMU' : '/getMUbulk', single ? JSON.stringify({coordinates:chunk[0].vertices.map(coord),detail:false}) : bulkBody(chunk), job);
            // 計算応答後のキャンセルでも結果を採用しない。
            if (job.cancelled) throw cancelled();
            // 単一応答も一覧に揃えて共通処理する。
            const rows = single ? [response] : response.results;
            // 結果一覧が配列でない応答を拒否する。
            if (!Array.isArray(rows)) fail('bulkレスポンスのresultsが無効です。');
            // bulkの各CFを独立して検証し、部分失敗を保持する。
            for (let i=0;i<chunk.length;i++) {
              const f = chunk[i];
              // bulkではCF番号で応答を対応付ける。
              const r = single ? rows[0] : rows.find(row => row && row.id === f.id);
              try {
                // 応答の欠落・個別失敗・対応位置の不一致を検出する。
                if (!r || (!single && (r.ok !== true || r.index !== i))) /* APIの個別エラーがあれば優先して知らせる。 */ fail(r && r.error ? String(r.error) : 'CFの応答が欠落・無効です。');
                const result = {mu:r.mu, area_km2:r.area_km2, model:response.model,
                  coordinates:r.coordinates, calculatedAt:new Date().toISOString()};
                // 不正なMU・面積・モデルを成功扱いにしない。
                if (!validResult(result)) fail('API計算結果のMU・面積・モデルが無効です。');
                // 応答にも3頂点が含まれることを確認する。
                if (!Array.isArray(r.coordinates) || r.coordinates.length !== 3) fail('API応答座標が無効です。');
                const returned = r.coordinates.map(p => {
                  // 文字列形式の応答座標を数値へ変換する。
                  if (typeof p === 'string') { const [lat,lng] = p.split(',').map(Number); return point({lat,lng}); }
                  return point(p);
                });
                // 要求したCFと異なる座標の結果を拒否する。
                if (fieldKey(returned) !== f.key) fail('API応答座標が要求したCFと一致しません。');
                f.result = result; f.status = 'success'; store.cache[f.key] = result;
              } catch (e) { f.status = 'error'; f.error = e.message; f.result = null; }
            }
          } catch (e) {
            // キャンセルは後続の分割リクエストも中止する。
            if (job.cancelled || e.cancelled) throw e;
            // 通信単位の失敗は、そのまとまりの全CFへ記録する。
            chunk.forEach(f => { f.status = 'error'; f.error = e.message; f.result = null; });
          }
          done += chunk.length; progress(done,snapshot.length); await pause();
        }
      } finally {
        // 全対象を確認し、中止時の未完了状態を解消する。
        for (const f of snapshot) /* 未完了のCFをキャンセル状態へ揃える。 */ if (f.status === 'running' || f.status === 'pending') { f.status = 'cancelled'; f.result = null; }
        // 長い計算中にモデルが変わった場合、結果は参考値として残し合計から除く。
        const models = new Set(snapshot.filter(f => f.status === 'success').map(f => f.result.model));
        // モデルが混在した結果を合計から除外する。
        if (models.size > 1) snapshot.forEach(f => { /* 成功結果もモデル未確認へ戻して再計算を促す。 */ if (f.status === 'success') { f.status = 'stale'; f.error = '計算中にモデルが変わりました。再計算してください。'; } });
        progress(done,snapshot.length);
      }
    }
    // 密なグラフでも定期的に制御を返し、線分の交差や途中点では分割しない。
    /**
     * Draw Toolsの図形から重複しない三角形候補を検出する。
     * @param {Object[]} items 読み取り専用の図形スナップショット。
     * @param {string} mode polygons・links・bothのいずれか。
     * @param {Object} job キャンセル状態。
     * @param {Function} progress 処理数と候補数の通知先。
     * @returns {Promise<Object>} 候補頂点と除外・重複の件数。
     */
    async function detect(items, mode, job, progress = () => {}) {
      const candidates = new Map(), nodes = new Map(), adjacency = new Map();
      let skipped = 0, duplicates = 0, steps = 0;
      /** 検出処理の途中で進捗を通知し、キャンセルと画面更新を受け付ける。 */
      async function tick() {
        // 500処理ごとに進捗を通知し、画面へ制御を戻す。
        if (++steps % 500 === 0) { progress(steps,candidates.size); await pause(); }
        // 検出中のキャンセルを速やかに反映する。
        if (job.cancelled) throw cancelled();
      }
      /** 有効な三角形候補を重複なく追加し、除外数を数える。 */
      function add(raw) {
        try { const v = triangle(raw), key = fieldKey(v); /* 既出候補は重複数に加え、新規候補だけを保存する。 */ if (candidates.has(key)) duplicates++; else candidates.set(key,v); }
        catch (_) { skipped++; }
      }
      /** 明示的な線分の両端を無向グラフへ登録する。 */
      function edge(a,b) {
        a = point(a); b = point(b); const ka = pointKey(a), kb = pointKey(b);
        // 両端が同じ線分は辺として登録しない。
        if (ka === kb) return;
        nodes.set(ka,a); nodes.set(kb,b);
        // 始点の隣接集合を必要な場合だけ作る。
        if (!adjacency.has(ka)) adjacency.set(ka,new Set());
        // 終点の隣接集合を必要な場合だけ作る。
        if (!adjacency.has(kb)) adjacency.set(kb,new Set());
        adjacency.get(ka).add(kb); adjacency.get(kb).add(ka);
      }
      // 図形を順に調べ、Polygonとリンクを取り出す。
      for (const item of items) {
        await tick();
        // 選択した検出モードにPolygonが含まれる場合だけ調べる。
        if (item.type === 'polygon' && mode !== 'links') {
          let ring = item.latLngs;
          // 旧Leafletの平坦なリングと現行の単一リング配列に対応する。
          // 単一リングだけを取り出し、穴や複数リングを除外する。
          if (Array.isArray(ring) && Array.isArray(ring[0])) /* リングが1つの場合だけ処理対象として取り出す。 */ ring = ring.length === 1 ? ring[0] : null;
          // 取り出せないリングは対象外として数える。
          if (!Array.isArray(ring)) { skipped++; continue; }
          try {
            ring = ring.map(point);
            // 閉じたリングの重複した終点を除く。
            if (ring.length > 1 && pointKey(ring[0]) === pointKey(ring[ring.length-1])) ring.pop();
            // 3頂点以外のPolygonを自動分割せず除外する。
            if (ring.length !== 3) { skipped++; continue; } add(ring);
          } catch (_) { skipped++; }
        }
        // 選択した検出モードにPolylineが含まれる場合だけ調べる。
        if (item.type === 'polyline' && mode !== 'polygons') {
          const line = item.latLngs;
          // 空や複雑な入れ子のPolylineは対象外にする。
          if (!Array.isArray(line) || !line.length || Array.isArray(line[0])) { skipped++; continue; }
          // 明示された連続頂点間だけを辺として登録する。
          for (let i=1;i<line.length;i++) { try { edge(line[i-1],line[i]); } catch (_) { skipped++; } await tick(); }
        }
      }
      // 接続数と座標キーで辺を一方向に揃え、各三角形を一度だけ列挙する。
      // 接続数が同じ場合は座標キーで順序を確定する。
      /** 接続数、座標キーの順に頂点の向きを一意に決める。 */
      const less = (a,b) => adjacency.get(a).size !== adjacency.get(b).size ? adjacency.get(a).size < adjacency.get(b).size : a < b;
      const forward = new Map();
      // 頂点ごとに前向きの隣接集合を作る。
      for (const [a, neighbors] of adjacency) {
        const next = new Set();
        // 各隣接頂点を一意な向きで選別する。
        for (const b of neighbors) { /* 順序が前向きになる辺だけを残す。 */ if (less(a,b)) next.add(b); await tick(); }
        forward.set(a,next);
      }
      // 頂点ごとに三角形の候補辺を調べる。
      for (const [a, neighbors] of forward) /* 前向きの辺ごとに共通の隣接頂点を探す。 */ for (const b of neighbors) {
        // 小さい集合を走査側、もう一方を検索側にする。
        const other = forward.get(b), small = neighbors.size < other.size ? neighbors : other, large = small === neighbors ? other : neighbors;
        // 小さい隣接集合だけを走査して比較量を抑える。
        for (const c of small) { /* 共通する隣接頂点があれば3辺の閉じた三角形として登録する。 */ if (large.has(c)) add([nodes.get(a),nodes.get(b),nodes.get(c)]); await tick(); }
      }
      return {vertices:[...candidates.values()], skipped, duplicates};
    }
    /**
     * CF一覧をBOM付きCSVへ変換する。
     * @param {Store} store 出力対象のストア。
     * @returns {string} 引用符・数式を保護したCSV。
     */
    function csv(store) {
      // 未計算などの空値は空文字で出力する。
      /** CSVセルの空値・数式先頭文字・引用符をエスケープする。 */
      const cell = value => '"'+String(value == null ? '' : value).replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
      const header = ['CF','頂点A','頂点B','頂点C','A緯度','A経度','B緯度','B経度','C緯度','C経度','MU','面積km²','状態','APIモデル','計算日時','エラー'];
      const rows = store.fields.map(f => [f.id,...f.vertices.map(p => p.name || pointKey(p)),...f.vertices.flatMap(p => [p.lat,p.lng]),
        f.result && f.result.mu,f.result && f.result.area_km2,f.status,f.result && f.result.model,f.result && f.result.calculatedAt,f.error]);
      return '\ufeff'+[header,...rows].map(row => row.map(cell).join(',')).join('\r\n');
    }
    return {VERSION, API, Store, point, pointKey, fieldKey, triangle, round6, validResult, bytes, batches, bulkBody, token, request, calculate, detect, csv, pause};
  }

  const core = createCore();
  // テスト時はIITCへ登録せず共通処理だけを返す。
  if (plugin_info && plugin_info.test) return core;
  // IITCが先に読み込まれていなくても名前空間を用意する。
  if (typeof window.plugin !== 'function') /** IITCが未起動の場合にプラグイン名前空間を用意する。 */ window.plugin = function () {};
  // 同じプラグインの二重登録を防ぐ。
  if (window.plugin.muCalculator) return;
  const p = window.plugin.muCalculator = {};
  const KEY = 'iitc.muCalculator.v1';
  let store = new core.Store(), root, dialogHandle, overlay, selectionLayer;
  let selecting = false, job = null, preview = null, renderFrame = null, saveTimer = null;
  const layers = new Map();
  p.core = core;
  /** 現行または旧IITCのAPIでスマートフォン表示を判定する。 */
  function mobile() {
    // 現行の端末判定APIがあれば優先する。
    if (window.IITC && window.IITC.utils && window.IITC.utils.isSmartphone) return window.IITC.utils.isSmartphone();
    return typeof window.isSmartphone === 'function' && window.isSmartphone();
  }
  /**
   * テキストを安全に設定したDOM要素を作る。
   * @param {string} tag HTMLタグ名。
   * @param {string} [text] 表示テキスト。
   * @param {string} [className] CSSクラス。
   * @returns {HTMLElement} 作成した要素。
   */
  function element(tag, text, className) {
    const e = document.createElement(tag); /* 指定されたテキストだけを安全に設定する。 */ if (text !== undefined) e.textContent = text; /* CSSクラスは指定がある場合だけ付ける。 */ if (className) e.className = className; return e;
  }
  /**
   * 例外通知に対応した操作ボタンを親要素へ追加する。
   * @param {string} text ボタン名。
   * @param {Function} action クリック時の処理。
   * @param {HTMLElement} parent 追加先。
   * @param {boolean} disabled 無効状態。
   * @returns {HTMLButtonElement} 作成したボタン。
   */
  function button(text, action, parent, disabled = false) {
    const b = element('button',text); b.type = 'button'; b.disabled = disabled;
    b.addEventListener('click',() => { Promise.resolve().then(action).catch(e => message(e.message)); }); parent.appendChild(b); return b;
  }
  /** 操作メッセージを更新し、パネルの再描画を予約する。 */
  function message(text) { p.message = String(text); schedule(false); }
  /** 連続した変更をまとめ、少し遅らせて保存する。 */
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { window.localStorage.setItem(KEY,JSON.stringify(store.export())); }
      catch (_) { message('保存できませんでした。JSON出力でバックアップしてください。'); }
    },250);
  }
  /**
   * 地図とパネルの更新要求をまとめて再描画を予約する。
   * @param {boolean} mapChanged 地図レイヤーも更新するか。
   */
  function schedule(mapChanged = true) {
    // 地図更新が必要な要求を次の描画まで保持する。
    if (mapChanged) p.mapDirty = true;
    // 描画予約がある場合は重複して予約しない。
    if (renderFrame !== null) return;
    renderFrame = setTimeout(() => { renderFrame = null; /* 地図に変更があるときだけレイヤーを更新する。 */ if (p.mapDirty) { draw(); p.mapDirty = false; } render(); },30);
  }
  /** データ変更を保存と描画へ反映する。 */
  function changed() { persist(); schedule(); }
  /**
   * 読み込み済みポータルから座標・GUID・名前を取得する。
   * @param {string} guid ポータルGUID。
   * @returns {Object|null} 正規化した頂点。未読込時はnull。
   */
  function fromPortal(guid) {
    const marker = window.portals && window.portals[guid];
    // 読み込み済みでないポータルは取得できないため返さない。
    if (!marker) return null;
    const ll = marker.getLatLng(), data = marker.options && marker.options.data || {};
    return core.point({lat:ll.lat,lng:ll.lng,guid,name:data.title || ''});
  }
  /** 読み込み済みポータルを座標キーで検索する索引を作る。 */
  function enrichIndex() {
    const index = new Map();
    // 読み込み済みの全ポータルを座標で索引化する。
    for (const guid of Object.keys(window.portals || {})) { try { const v = fromPortal(guid); index.set(core.pointKey(v),v); } catch (_) { /* 情報が未取得のマーカーは読み飛ばす。 */ } }
    return index;
  }
  /**
   * IITCのポータル選択通知を、選択中のCF作成へ反映する。
   * @param {Object} data portalSelectedの通知内容。
   */
  function onSelected(data) {
    // 選択中以外・処理中・不正な通知では登録しない。
    if (!selecting || job || !data || !data.selectedPortalGuid) return;
    try {
      const v = fromPortal(data.selectedPortalGuid); /* 座標を取得できないポータルは読み飛ばす。 */ if (!v) return;
      const result = store.select(v);
      // 登録結果の案内がある場合だけ表示する。
      if (result.message) message(result.message);
      // 単一CFは3頂点で選択を自動終了する。
      if (store.mode === 'single' && store.selection.length === 3) selecting = false;
      changed();
    } catch (e) { message(e.message); }
  }
  /** ポータルの連続選択を開始し、操作案内を表示する。 */
  function startSelection() {
    selecting = true; preview = null;
    // 地図画面への切替は開始時だけ行い、各タップでは切り替えない。
    // スマートフォンでは選択開始時だけ地図画面を開く。
    if (mobile() && typeof window.show === 'function') window.show('map');
    // 共通辺モードにはA・B固定の選択手順を案内する。
    message(store.mode === 'edge' ? 'A・Bを選択し、続けてC頂点を選択してください。' : '地図のポータルを順番に3つ選択してください。'); changed();
  }
  /** 登録CF・選択頂点・共通辺を専用地図レイヤーへ反映する。 */
  function draw() {
    // レイヤー初期化前の描画を避ける。
    if (!overlay) return;
    const keys = new Set(store.fields.map(f => f.key));
    // 保持しているレイヤーから不要なものを取り除く。
    for (const [key,layer] of layers) /* 削除済みCFの地図レイヤーも取り除く。 */ if (!keys.has(key)) { overlay.removeLayer(layer); layers.delete(key); }
    // 各CFの形状を再利用し、色・強調・表示状態を反映する。
    for (const f of store.fields) {
      // 再利用されるCF番号ではなく座標キーで図形を対応付ける。
      let layer = layers.get(f.key);
      // 既存レイヤーがないCFだけ新しく描画する。
      if (!layer) {
        const coords = f.vertices.map(v => [v.lat,v.lng]);
        // 大円描画が使えれば優先し、それ以外は標準Polygonにする。
        layer = (typeof L.geodesicPolygon === 'function' ? L.geodesicPolygon(coords) : L.polygon(coords));
        // CFの塗りを通してポータルをタップできるようにする。
        layer.options.interactive = false; layer.options.clickable = false;
        layers.set(f.key,layer);
      }
      const selected = store.highlight === f.id;
      // 強調中のCFは線と塗りを目立たせる。
      layer.setStyle({color:f.color, fillColor:f.color, weight:selected ? 5 : 2, fillOpacity:selected ? 0.28 : 0.10, opacity:selected ? 1 : 0.7, interactive:false, clickable:false});
      // 表示対象で未追加のCFをレイヤーへ加える。
      if (f.visible && !overlay.hasLayer(layer)) overlay.addLayer(layer);
      // 非表示にしたCFの描画を取り除く。
      if (!f.visible && overlay.hasLayer(layer)) overlay.removeLayer(layer);
      // 強調したCFを手前へ出して見やすくする。
      if (selected && f.visible && layer.bringToFront) layer.bringToFront();
    }
    selectionLayer.clearLayers();
    const active = store.fields.find(f => f.id === store.highlight);
    // 強調CFがあればその頂点、なければ選択中の頂点を示す。
    const points = active ? active.vertices : store.selection;
    // 各頂点へ操作を遮らないマーカーと役割ラベルを付ける。
    points.forEach((v,i) => {
      // 頂点の順序とモードに応じてA・B・C番号を付ける。
      const label = i === 0 ? 'A' : i === 1 ? 'B' : store.mode === 'edge' && !active ? 'C'+(i-1) : 'C';
      L.circleMarker([v.lat,v.lng],{radius:8,color:'#fff',weight:3,fillColor:'#ffb347',fillOpacity:0.8,interactive:false,clickable:false}).addTo(selectionLayer);
      const text = element('span',label,'muc-vertex');
      L.marker([v.lat,v.lng],{interactive:false,clickable:false,keyboard:false,icon:L.divIcon({html:text.outerHTML,className:'muc-label',iconSize:[32,24],iconAnchor:[-8,24]})}).addTo(selectionLayer);
    });
    // 共通辺の2頂点が揃った場合だけ太線を引く。
    if (store.mode === 'edge' && store.selection.length >= 2) {
      const coordinates = store.selection.slice(0,2).map(v => [v.lat,v.lng]);
      // 共通辺も利用可能なら大円で描画する。
      const line = typeof L.geodesicPolyline === 'function' ? L.geodesicPolyline(coordinates) : L.polyline(coordinates);
      line.setStyle({color:'#fff',weight:6,opacity:0.9,interactive:false,clickable:false}); line.addTo(selectionLayer);
    }
  }
  /**
   * 画面から計算を開始し、進捗と終了状態を反映する。
   * @returns {Promise<void>} 計算と画面状態の更新完了。
   */
  async function runCalculation() {
    // 実行中または対象CFがない場合は計算を始めない。
    if (job || !store.fields.length) return;
    selecting = false; const activeJob = job = core.token();
    try {
      await core.calculate(store,activeJob,core.request,(done,total) => { p.progress = '計算 '+done+' / '+total; schedule(false); });
      message('計算を終了しました。失敗したCFは再計算できます。');
    } catch (e) { message(e.message); }
    finally { /* 終了したジョブが現在のものなら実行中状態を解除する。 */ if (job === activeJob) job = null; p.progress = ''; changed(); }
  }
  /**
   * Draw Toolsの図形を元データと共有しない座標配列へコピーする。
   * @returns {Object[]} PolygonとPolylineのスナップショット。
   */
  function snapshotDraw() {
    const dt = window.plugin.drawTools;
    // Draw Toolsの読み取りインターフェースがなければ案内する。
    if (!dt || !dt.drawnItems || !dt.drawnItems.eachLayer) throw new Error('Draw Toolsが導入されていません。');
    const items = [];
    // 描画レイヤーを読み取るだけにし、元の図形は変更しない。
    dt.drawnItems.eachLayer(layer => {
      /** 存在するLeafletの型だけを使って描画レイヤーを判定する。 */
      const isType = name => typeof L[name] === 'function' && layer instanceof L[name];
      let type;
      // Polygonを先に判定し、Polylineとの継承関係を考慮する。
      if (isType('Polygon') || isType('GeodesicPolygon')) type = 'polygon';
      else /* Polygon以外のPolylineをリンク候補として扱う。 */ if (isType('Polyline') || isType('GeodesicPolyline')) type = 'polyline';
      // 対応する図形だけを独立した座標配列へコピーする。
      if (type) {
        // 元のDraw Toolsレイヤーを変更しないよう、座標だけを独立させる。
        // 配列は再帰コピーし、座標は新しいオブジェクトにする。
        /** 入れ子の座標配列を再帰的にコピーする。 */
        const copy = value => Array.isArray(value) ? value.map(copy) : {lat:value.lat,lng:value.lng};
        items.push({type,latLngs:copy(layer.getLatLngs())});
      }
    }); return items;
  }
  /**
   * Draw Toolsを解析し、登録前の候補件数を表示する。
   * @param {string} mode 検出対象の区分。
   * @returns {Promise<void>} 候補プレビューの更新完了。
   */
  async function detectDraw(mode) {
    // 別の処理が実行中なら解析を重ねない。
    if (job) return;
    const items = snapshotDraw(), activeJob = job = core.token(); preview = null; selecting = false;
    try {
      p.progress = 'Draw Toolsを解析中…'; schedule(false);
      const found = await core.detect(items,mode,activeJob,(_,count) => { p.progress = '解析中：候補 '+count; schedule(false); });
      // キャンセルした解析結果はプレビューに反映しない。
      if (activeJob.cancelled) return;
      const index = enrichIndex();
      const vertices = found.vertices.filter(v => !store.byKey.has(core.fieldKey(v)));
      preview = {...found, vertices:vertices.map(v => v.map(point => index.get(core.pointKey(point)) || point)), existing:found.vertices.length-vertices.length};
      message('検出 '+found.vertices.length+' CF、追加可能 '+vertices.length+' CF。内容を確認して登録してください。');
    } catch (e) { message(e.message); }
    finally { /* 現在の解析ジョブだけを終了状態へ戻す。 */ if (job === activeJob) job = null; p.progress = ''; schedule(false); }
  }
  /**
   * IITC・Android・ブラウザに対応した経路で結果を保存する。
   * @param {string} kind csvまたはjson。
   */
  function download(kind) {
    // CSVとJSONで出力形式を切り替える。
    const text = kind === 'csv' ? core.csv(store) : JSON.stringify(store.export(),null,2);
    // 出力形式に合うMIMEタイプを指定する。
    const name = 'iitc-mu-calculator.'+kind, type = kind === 'csv' ? 'text/csv' : 'application/json';
    // 現行IITCの共通エクスポート機能を優先する。
    if (window.IITC && window.IITC.utils && typeof window.IITC.utils.exportFile === 'function') window.IITC.utils.exportFile(text,name,type);
    else /* 旧Android環境ではネイティブ保存機能へ渡す。 */ if (window.app && typeof window.app.saveFile === 'function') window.app.saveFile(name,type,text);
    else /* 旧IITCの保存関数があれば利用する。 */ if (typeof window.saveFile === 'function') window.saveFile(text,name,type);
    else {
      const url = URL.createObjectURL(new Blob([text],{type:type+';charset=utf-8'}));
      const a = element('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),60000);
    }
  }
  /**
   * JSONを検証してから現在の計画と描画を置き換える。
   * @param {string} text インポートするJSON本文。
   */
  function importJSON(text) {
    // 処理中の計画の置き換えを防ぐ。
    if (job) throw new Error('処理終了後にインポートしてください。');
    const next = core.Store.parse(JSON.parse(text.replace(/^\ufeff/,'')));
    // 呼出元で確認済みのJSONを検証し終えてから、計画を一括で置き換える。
    store = next; selecting = false; preview = null;
    // 置き換え前のCFレイヤーを取り除く。
    for (const layer of layers.values()) overlay.removeLayer(layer); layers.clear();
    message('JSONを読み込みました。保存されたMUはモデル確認まで参考値です。'); changed();
  }
  /** 数値を日本語の桁区切りと小数3桁以内で表示する。 */
  const format = n => n.toLocaleString('ja-JP',{maximumFractionDigits:3});
  const statuses = {pending:'未計算',running:'計算中',success:'成功',error:'失敗',stale:'モデル未確認',cancelled:'キャンセル'};
  /** 操作状態・計算結果・一覧をパネルへ描画する。 */
  function render() {
    // 開いているパネルがある場合だけ再描画する。
    if (!root || !root.isConnected) return;
    // 再描画前のスクロール位置を保持する。
    const scroll = root.querySelector('.muc-scroll'), scrollTop = scroll ? scroll.scrollTop : 0;
    root.replaceChildren();
    // 選択中だけ頂点数を状態欄へ加える。
    const status = element('div',(selecting ? '選択中 · '+store.selection.length+'頂点　' : '')+(p.progress || p.message || 'ポータル選択またはDraw Tools取り込みを開始してください。'),'muc-status');
    status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); root.appendChild(status);
    const quick = element('div',undefined,'muc-toolbar'); root.appendChild(quick);
    // 選択状態に合わせて操作名を切り替える。
    button(selecting ? '選択終了' : '選択開始',() => { /* 選択中なら終了し、それ以外なら選択を開始する。 */ if (selecting) { selecting = false; changed(); } else startSelection(); },quick,!!job);
    button('MU計算',runCalculation,quick,!!job || !store.fields.length);
    button('キャンセル',() => job && job.cancel(),quick,!job);
    const body = element('div',undefined,'muc-scroll'); root.appendChild(body);
    const controls = element('div',undefined,'muc-toolbar'); body.appendChild(controls);
    const label = element('label','選択モード '), select = element('select'); label.appendChild(select); controls.appendChild(label);
    // 利用可能な3つの選択モードを表示する。
    for (const [value,text] of [['single','単一CF'],['edge','共通辺固定'],['free','自由選択']]) {
      const opt = element('option',text); opt.value = value; opt.selected = store.mode === value; select.appendChild(opt);
    }
    select.disabled = !!job; /** 選択モードを変更し、進行中の頂点選択を初期化する。 */ select.onchange = () => { store.mode = select.value; store.selection = []; selecting = false; changed(); };
    const drawControls = element('fieldset'); drawControls.appendChild(element('legend','Draw Toolsから取り込み')); body.appendChild(drawControls);
    const available = !!(window.plugin.drawTools && window.plugin.drawTools.drawnItems);
    // Draw Toolsの3種類の取り込み操作を追加する。
    for (const [mode,text] of [['polygons','三角形Polygon'],['links','リンクから検出'],['both','両方']]) button(text,() => detectDraw(mode),drawControls,!!job || !available);
    // Draw Toolsがなければ直接選択を案内する。
    if (!available) drawControls.appendChild(element('p','Draw Tools未導入：直接選択は利用できます。'));
    // 解析済み候補がある場合だけ登録確認を表示する。
    if (preview) {
      const box = element('div',undefined,'muc-preview'); body.appendChild(box);
      box.appendChild(element('p','追加可能 '+preview.vertices.length+' CF／登録済み '+preview.existing+'／対象外・無効図形 '+preview.skipped+'／候補内重複 '+preview.duplicates));
      button('確認して登録',async () => {
        const candidates = preview.vertices; preview = null; const activeJob = job = core.token();
        try { /* 候補を順次登録し、大量データでも中断可能にする。 */ for (let i=0;i<candidates.length;i++) { /* 登録途中のキャンセルでは追加済みCFを残して終了する。 */ if (activeJob.cancelled) break; store.add(candidates[i],'draw'); /* 100件ごとに進捗を表示し、入力を受け付ける。 */ if (i % 100 === 0) { p.progress = '登録 '+i+' / '+candidates.length; schedule(false); await core.pause(); } } }
        finally { job = null; p.progress = ''; changed(); }
      },box,!!job || !preview.vertices.length);
      button('取り込み中止',() => { preview = null; schedule(false); },box,!!job);
    }
    const s = store.summary();
    body.appendChild(element('p','登録 '+s.count+' CF · 成功 '+s.success+' · 失敗 '+s.failed+' · 未完了 '+(s.count-s.success-s.failed),'muc-summary'));
    // 未完了CFがあれば合計を成功分小計として表示する。
    body.appendChild(element('p',(s.partial ? '成功分小計 ' : '合計推定 ')+format(s.mu)+' MU / 面積合計 '+format(s.area)+' km²','muc-total'));
    body.appendChild(element('p','APIモデル：'+(s.models.join(', ') || '未確認')+'。CF枚数は最大重複レイヤー数を表しません。'));
    const selected = element('details'); selected.open = true; selected.appendChild(element('summary','選択ポータル '+store.selection.length)); body.appendChild(selected);
    // CF一覧と同様に、多数の選択頂点もページに分ける。
    const selectionPages = Math.max(1,Math.ceil(store.selection.length/50));
    p.selectionPage = Math.min(p.selectionPage || 0,selectionPages-1);
    // 選択頂点が複数ページに跨がる場合だけ移動操作を表示する。
    if (selectionPages > 1) {
      const nav = element('div',undefined,'muc-toolbar'); selected.appendChild(nav);
      button('前の頂点',() => { p.selectionPage--; schedule(false); },nav,p.selectionPage === 0);
      nav.appendChild(element('span',(p.selectionPage+1)+' / '+selectionPages));
      button('次の頂点',() => { p.selectionPage++; schedule(false); },nav,p.selectionPage === selectionPages-1);
    }
    // 現在のページの選択頂点だけを表示し、個別の削除操作を付ける。
    store.selection.slice(p.selectionPage*50,(p.selectionPage+1)*50).forEach((v,j) => {
      const i = p.selectionPage*50+j;
      const row = element('div',undefined,'muc-portal'); selected.appendChild(row);
      // モードに合わせて選択頂点の役割を表示する。
      row.appendChild(element('span',(i<2 ? ['A','B'][i] : store.mode === 'edge' ? 'C'+(i-1) : 'C')+': '+(v.name || core.pointKey(v))));
      button('頂点を削除',() => { store.selection.splice(i,1); selecting = false; changed(); },row,!!job);
    });
    const count = Math.max(1,Math.ceil(store.fields.length/50)); p.page = Math.min(p.page || 0,count-1);
    const nav = element('div',undefined,'muc-toolbar'); body.appendChild(nav);
    button('前へ',() => { p.page--; schedule(false); },nav,p.page === 0); nav.appendChild(element('span','CF一覧 '+(p.page+1)+' / '+count));
    button('次へ',() => { p.page++; schedule(false); },nav,p.page === count-1);
    // 現在のページに含まれるCFだけ一覧へ描画する。
    for (const f of store.fields.slice(p.page*50,(p.page+1)*50)) {
      const card = element('article',undefined,'muc-field'); card.style.borderLeftColor = f.color; body.appendChild(card);
      card.appendChild(element('strong',f.id+' · '+statuses[f.status]));
      card.appendChild(element('div',f.vertices.map((v,i) => ['A','B','C'][i]+': '+(v.name || core.pointKey(v))).join(' / ')));
      // 結果の有無とモデル確認状態に応じて数値を表示する。
      card.appendChild(element('p',f.result ? format(f.result.mu)+' MU / '+format(f.result.area_km2)+' km²'+(f.status !== 'success' ? '（参考値）' : '') : 'MU — / 面積 —'));
      // 計算エラーがあるCFには内容を表示する。
      if (f.error) card.appendChild(element('p',f.error,'muc-error'));
      const actions = element('div',undefined,'muc-toolbar'); card.appendChild(actions);
      // 現在の表示状態に応じた切替操作を示す。
      button(f.visible ? '非表示にする' : '表示する',() => { f.visible = !f.visible; changed(); },actions);
      // 同じCFの再指定で強調を解除できるようにする。
      button(store.highlight === f.id ? '強調解除' : '強調表示',() => { store.highlight = store.highlight === f.id ? '' : f.id; changed(); },actions);
      const color = element('input'); color.type = 'color'; color.value = f.color; color.setAttribute('aria-label',f.id+' の色'); /** CFの色変更を地図と保存データへ反映する。 */ color.onchange = () => { f.color = color.value; changed(); }; actions.appendChild(color);
      button('CF削除',() => { store.remove(f.id); changed(); },actions,!!job);
    }
    const exports = element('div',undefined,'muc-toolbar'); body.appendChild(exports);
    button('CSV出力',() => download('csv'),exports); button('JSON出力',() => download('json'),exports);
    button('JSONインポート',() => { p.importOpen = !p.importOpen; schedule(false); },exports,!!job);
    button('全クリア',() => { /* 確認された場合だけCF・選択・キャッシュを全て消去する。 */ if (window.confirm('登録CF・選択頂点・計算キャッシュを全て削除しますか？')) { store.clear(); selecting = false; preview = null; changed(); } },exports,!!job);
    // インポート操作を開いている場合だけ入力欄を表示する。
    if (p.importOpen) {
      const hint = element('p','JSONファイルまたはテキストで現在の計画を置き換えます。'); body.appendChild(hint);
      const file = element('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label','JSONファイル'); body.appendChild(file);
      /** 選択されたJSONファイルをテキストとして読み込む。 */
      file.onchange = () => {
        // ファイルが選ばれなければ何もしない。
        if (!file.files[0]) return; const reader = new FileReader();
        /** ファイル読込後に確認を求め、JSONをインポートする。 */
        reader.onload = () => { try { /* 現在の計画を置き換える前に確認する。 */ if (window.confirm('現在の計画をJSONの内容で置き換えますか？')) importJSON(String(reader.result)); } catch (e) { message(e.message); } };
        /** ファイルの読み込み失敗を画面へ通知する。 */
        reader.onerror = () => message('ファイルを読み込めませんでした。'); reader.readAsText(file.files[0]);
      };
      const text = element('textarea'); text.placeholder = 'JSONを貼り付け'; text.setAttribute('aria-label','インポートJSON'); body.appendChild(text);
      button('貼り付け内容を読み込む',() => { /* 貼り付けたJSONも確認後に読み込む。 */ if (window.confirm('現在の計画をJSONの内容で置き換えますか？')) importJSON(text.value); },body,!!job);
    }
    body.appendChild(element('p','MUは外部APIによる推定値です。計算時に頂点座標を api.investigatexm.com に送信します。重なる面積は各CFで加算します。全CFの成立・リンク順序・既存リンクとの干渉は保証しません。Draw Toolsの図形は実在ポータルやリンク構築可能性を保証しません。','muc-notice'));
    body.scrollTop = scrollTop;
  }
  /** 両端末でIITC標準のタイトルバー付きパネルを開く。既存パネルは再利用する。 */
  p.open = function () {
    const isMobile = mobile();
    // モバイルのToolboxが別画面にある場合も、パネルと地図を同時に表示する。
    if (isMobile && typeof window.show === 'function') window.show('map');
    // 既に開いているパネルは再利用して更新する。
    if (root && root.isConnected) { dialogHandle.dialog('moveToTop'); schedule(false); return; }
    root = element('section',undefined,'muc-panel'); root.id = 'mu-calculator-panel'; root.setAttribute('aria-label','MU Calculator');
    // 閉じる・最小化はIITC標準の操作を使い、モバイルの配置だけCSSで調整する。
    dialogHandle = window.dialog({id:'mu-calculator',title:'MU Calculator',html:root,width:460,modal:false,buttons:[],
      classes:{'ui-dialog':isMobile ? 'muc-dialog muc-dialog-mobile' : 'muc-dialog'},
      /** 標準の×で閉じたら選択を終了し、CFを保持して再表示できる状態へ戻す。 */
      closeCallback:() => { selecting = false; root = null; dialogHandle = null; persist(); }});
    L.DomEvent.disableClickPropagation(root); L.DomEvent.disableScrollPropagation(root); render();
  };
  /** 保存データ・専用レイヤー・イベント・Toolboxを一度だけ初期化する。 */
  function setup() {
    // イベントやレイヤーを二重に初期化しない。
    if (p.initialized) return; p.initialized = true;
    try { const saved = window.localStorage.getItem(KEY); /* 保存済みデータがある場合だけ復元する。 */ if (saved) store = core.Store.parse(JSON.parse(saved)); }
    catch (e) { p.message = '保存データを復元できません：'+e.message+' 元の保存内容は次の変更まで保持されます。'; }
    overlay = new L.LayerGroup(); selectionLayer = new L.LayerGroup(); overlay.addLayer(selectionLayer);
    // 標準登録APIを優先し、未対応ならLayer Chooserへ直接登録する。
    if (typeof window.addLayerGroup === 'function') window.addLayerGroup('MU Calculator',overlay,true);
    else { window.layerChooser.addOverlay(overlay,'MU Calculator'); overlay.addTo(window.map); }
    window.addHook('portalSelected',onSelected);
    // ポータル詳細処理は維持し、他のモバイル画面ではタイトルバーごと隠す。
    window.addHook('paneChanged',pane => { /* 地図以外ではダイアログ全体を隠す。 */ if (dialogHandle && mobile()) dialogHandle.dialog('widget').prop('hidden',pane !== 'map'); /* 地図・情報以外へ移った場合は選択を終了する。 */ if (pane !== 'map' && pane !== 'info') { selecting = false; persist(); } });
    window.addEventListener('pagehide',() => {
      // ページ離脱時は実行中の通信を中断する。
      if (job) job.cancel(); selecting = false;
      try { window.localStorage.setItem(KEY,JSON.stringify(store.export())); } catch (_) { /* 離脱時は保存できなくても画面遷移を妨げない。 */ }
    });
    window.addEventListener('keydown',event => { /* パネル表示中のEscapeで選択と実行中処理を終了する。 */ if (event.key === 'Escape' && root) { /* 実行中のジョブがある場合だけ中断する。 */ if (job) job.cancel(); selecting = false; changed(); } });
    const style = element('style'); style.textContent = `
      .muc-panel{font:13px/1.5 sans-serif;color:#eee;background:#102329;box-sizing:border-box;max-width:100%;overflow:hidden}
      .muc-panel *{box-sizing:border-box}.muc-panel button,.muc-panel select{min-height:44px;max-width:100%;padding:6px 10px;margin:2px;color:#fff;background:#20434b;border:1px solid #67939b;border-radius:5px;cursor:pointer;font:inherit}
      .muc-panel button:disabled{opacity:.45;cursor:default}.muc-panel button:focus-visible{outline:2px solid #ffbd55}.muc-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:3px;padding:3px}
      .muc-toolbar strong{flex:1}.muc-status{padding:4px 8px;overflow-wrap:anywhere}.muc-scroll{max-height:60vh;max-height:60dvh;overflow:auto;overscroll-behavior:contain;padding:6px;-webkit-overflow-scrolling:touch}
      .muc-field{border:1px solid #45656c;border-left:5px solid;margin:8px 0;padding:8px;overflow-wrap:anywhere}.muc-panel p{margin:6px 0}.muc-total{font-size:17px;font-weight:bold}.muc-notice{font-size:12px;color:#d1dfe1}.muc-error{color:#ffb0aa}
      .muc-panel fieldset{margin:8px 0;border:1px solid #45656c}.muc-panel textarea{width:100%;min-height:120px}.muc-panel input[type=file]{max-width:100%}.muc-panel input[type=color]{width:44px;height:44px}.muc-portal{display:flex;align-items:center;justify-content:space-between;gap:8px;overflow-wrap:anywhere}.muc-portal span{min-width:0}
      .muc-preview{border:1px solid #ffbd55;padding:8px}.muc-dialog-mobile{position:fixed!important;left:8px!important;right:8px;top:auto!important;bottom:calc(40px + env(safe-area-inset-bottom,0px))!important;width:calc(100% - 16px)!important;box-sizing:border-box;max-height:70vh;max-height:70dvh;display:flex!important;flex-direction:column}
      .muc-dialog-mobile[hidden]{display:none!important}.muc-dialog-mobile>.ui-dialog-content{padding:0;min-height:0!important;overflow:hidden;flex:0 1 auto}.muc-dialog-mobile .muc-panel{display:flex;flex-direction:column;max-height:calc(70vh - 44px);max-height:calc(70dvh - 44px)}
      .muc-dialog-mobile .muc-panel>.muc-toolbar,.muc-dialog-mobile .muc-status{flex-shrink:0}.muc-dialog-mobile .muc-scroll{min-height:0;max-height:none;flex:1 1 auto}.muc-dialog-mobile .ui-dialog-titlebar{min-height:36px;flex-shrink:0}.muc-dialog-mobile .ui-dialog-title{margin-right:74px;width:calc(100% - 82px)}
      .muc-dialog-mobile .ui-dialog-titlebar-button{width:32px;height:32px;min-width:32px;min-height:32px;top:50%;margin-top:-16px}.muc-dialog-mobile .ui-dialog-titlebar-button-close{right:2px}.muc-dialog-mobile .ui-dialog-titlebar-button-collapse{right:36px}
      .muc-vertex{background:#102329;color:#fff;border:1px solid #fff;border-radius:3px;padding:1px 4px;white-space:nowrap;pointer-events:none}.muc-label{pointer-events:none}
      @media(max-height:450px){.muc-dialog-mobile{bottom:32px!important;max-height:85vh;max-height:85dvh}.muc-dialog-mobile .muc-panel{max-height:calc(85vh - 44px);max-height:calc(85dvh - 44px)}}
    `; document.head.appendChild(style);
    // 現行Toolbox APIが使える場合はボタンとして登録する。
    if (window.IITC && window.IITC.toolbox && window.IITC.toolbox.addButton) window.IITC.toolbox.addButton({id:'mu-calculator-toolbox',label:'MU Calculator',action:p.open});
    else {
      const toolbox = document.getElementById('toolbox');
      // 旧Toolboxがある場合はリンクを追加する。
      if (toolbox) { const a = element('a','MU Calculator'); a.href = '#'; /** 旧Toolboxのリンクからパネルを開き、リンク先への遷移を防ぐ。 */ a.onclick = e => { e.preventDefault(); p.open(); }; toolbox.appendChild(a); }
    }
    draw();
  }
  setup.info = plugin_info;
  // 起動処理一覧がなければ作成する。
  if (!window.bootPlugins) window.bootPlugins = [];
  window.bootPlugins.push(setup);
  // IITCの起動後に読み込まれた場合も即時初期化する。
  if (window.iitcLoaded) setup();
}

// Androidローダーが末尾2行を文字列置換するため、注入コードの形式を維持する。
// Node.jsではテスト用に公開し、ブラウザではページへ注入する。
if (typeof module === 'object' && module.exports) {
  module.exports = wrapper({test:true});
} else {
  var script = document.createElement('script');
  var info = {};
  // 利用できるユーザースクリプト情報だけをラッパーへ渡す。
  if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = {version:GM_info.script.version,name:GM_info.script.name,description:GM_info.script.description};
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);
}
