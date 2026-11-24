// Tài khoản + đồng bộ nhiều thiết bị bằng Firebase (Auth: Google + link email; Firestore).
// - Không đụng DOM. Local-first: core/store.js vẫn là nguồn chính, mất mạng vẫn học bình thường.
// - FIREBASE_CONFIG = null → mọi hàm ở đây tắt êm (chế độ khách), KHÔNG nạp gì từ mạng.
// - SDK nạp LAZY từ CDN gstatic (phiên bản cố định) chỉ khi: người dùng bấm đăng nhập, đã đăng nhập từ trước,
//   hoặc app được mở bằng link đăng nhập trong email.
// - Hàng đợi tự quản: phần đổi được đánh dấu "bẩn" trong localStorage (khóa hsk-v2-sync-meta), ghi gộp sau khi
//   ngừng thao tác ≥ 8 s và cách lần ghi trước ≥ 120 s; mất mạng thì để đó, có mạng ghi tiếp. Dùng Firestore Lite (REST).
// Quy tắc gộp: core/sync-merge.js. API cho giao diện: core/README.md mục "Tài khoản & đồng bộ".
import * as defaultStore from "./store.js";
import { FIREBASE_CONFIG } from "./firebase-config.js";
import * as M from "./sync-merge.js";

export const SDK_VERSION = "12.4.0";
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;
export const META_KEY = "hsk-v2-sync-meta";
export const EMAIL_KEY = "hsk-v2-sync-email";
export const REDIRECT_KEY = "hsk-v2-sync-redirect";
export const UI_PREF_KEY = "hsk-v2-ui-prefs"; // cùng khóa với ui/api.js
export const DEBOUNCE_MS = 8000; // gộp thay đổi: chờ ngừng thao tác
export const MIN_PUSH_GAP_MS = 120000; // hai lần ghi tự động cách nhau tối thiểu
export const HIDDEN_PUSH_GAP_MS = 20000; // khi app bị đưa xuống nền thì ghi sớm hơn
export const PULL_GAP_MS = 600000; // quay lại app sau ≥ 10 phút thì kéo dữ liệu mới
export const PREFS_POLL_MS = 30000; // ui/ ghi ⭐ thẳng vào localStorage nên phải dò

const defaultLoadSdk = async () => {
  const [app, auth, fs] = await Promise.all([import(`${CDN}firebase-app.js`), import(`${CDN}firebase-auth.js`), import(`${CDN}firebase-firestore-lite.js`)]);
  return { app, auth, fs };
};

const emptyDirty = () => ({ p: false, days: {}, units: {}, cards: {}, lv: {}, prefs: false, all: false, replace: false });
const emptyMeta = () => ({ v: 1, deviceId: "", user: null, uid: "", base: {}, seen: { p: false, c: {}, prefs: {} }, dirty: emptyDirty(), stars: {}, prefsAt: 0, prefsSnap: "", resetAt: 0, lastSyncAt: 0, signOutPending: false });
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const sameMap = (a, b) => {
  const x = isObj(a) ? a : {};
  const y = isObj(b) ? b : {};
  const kx = Object.keys(x);
  return kx.length === Object.keys(y).length && kx.every((k) => x[k] === y[k]);
};
const err = (code, message) => Object.assign(new Error(message || code), { code });
const OFFLINE_CODES = /unavailable|network-request-failed|deadline-exceeded|sync\/offline|sync\/sdk-load-failed/;

/**
 * Tạo một bộ đồng bộ. App dùng bản mặc định (các hàm export ở cuối file); test tạo bản riêng với SDK / kho lưu giả.
 * opts: { store, config, storage, session, loadSdk, env: { location, history, navigator, document, window, setTimeout, clearTimeout, setInterval, now } }
 */
export function createSync(opts = {}) {
  const g = globalThis;
  const store = opts.store || defaultStore;
  const config = opts.config === undefined ? FIREBASE_CONFIG : opts.config;
  const loadSdkFn = opts.loadSdk || defaultLoadSdk;
  const env = opts.env || {};
  const now = env.now || (() => Date.now());
  const setT = env.setTimeout || ((fn, ms) => g.setTimeout(fn, ms));
  const clearT = env.clearTimeout || ((id) => g.clearTimeout(id));
  const safe = (get) => {
    try {
      return get() ?? null;
    } catch {
      return null;
    }
  };
  const storage = opts.storage !== undefined ? opts.storage : safe(() => g.localStorage);
  const session = opts.session !== undefined ? opts.session : safe(() => g.sessionStorage);
  const loc = () => (env.location !== undefined ? env.location : safe(() => g.location));
  const nav = () => (env.navigator !== undefined ? env.navigator : safe(() => g.navigator));
  const win = () => (env.window !== undefined ? env.window : safe(() => g.window));
  const docu = () => (env.document !== undefined ? env.document : safe(() => g.document));

  let meta = null;
  let sdk = null;
  let sdkPromise = null;
  let auth = null;
  let db = null;
  let fbUser = null;
  let state = "off";
  let lastError = null;
  let needEmail = false;
  let applying = false;
  let deleting = false;
  let initPromise = null;
  let timer = null;
  let lastPushAt = 0;
  let lastPullAt = 0;
  let remoteAppliedAt = 0;
  let queue = Promise.resolve();
  const listeners = new Set();

  // ---------- meta (localStorage) ----------
  const getItem = (k) => safe(() => storage?.getItem(k));
  const setItem = (k, v) => void safe(() => storage?.setItem(k, v));
  const removeItem = (k) => void safe(() => storage?.removeItem?.(k));
  function readMeta() {
    if (meta) return meta;
    const base = emptyMeta();
    const raw = safe(() => JSON.parse(getItem(META_KEY) || "null"));
    meta = isObj(raw) ? { ...base, ...raw, seen: { ...base.seen, ...(isObj(raw.seen) ? raw.seen : {}) }, dirty: { ...base.dirty, ...(isObj(raw.dirty) ? raw.dirty : {}) } } : base;
    if (!meta.deviceId) {
      meta.deviceId = `d${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
      if (isEnabled()) writeMeta();
    }
    return meta;
  }
  const writeMeta = () => setItem(META_KEY, JSON.stringify(meta));
  const hasDirty = () => {
    const d = readMeta().dirty;
    return d.p || d.prefs || d.all || d.replace || Object.keys(d.days).length > 0 || Object.keys(d.units).length > 0 || Object.keys(d.cards).length > 0 || Object.keys(d.lv).length > 0;
  };

  // ---------- trạng thái ----------
  const pickUser = (u) => (u ? { uid: u.uid, email: u.email || "", displayName: u.displayName || "", photoURL: u.photoURL || "" } : null);
  function isEnabled() {
    return Boolean(config && typeof config === "object" && config.apiKey && config.projectId);
  }
  function currentUser() {
    if (!isEnabled()) return null;
    return readMeta().user ? { ...meta.user } : null;
  }
  function status() {
    const on = isEnabled();
    const user = on ? currentUser() : null;
    return {
      state: on && user ? state : "off",
      lastSyncAt: on ? readMeta().lastSyncAt || 0 : 0,
      user,
      enabled: on,
      needEmail,
      pending: on && Boolean(user) && hasDirty(),
      error: lastError ? { code: lastError.code || "unknown", message: String(lastError.message || lastError) } : null,
      remoteAppliedAt,
    };
  }
  function emit() {
    const s = status();
    listeners.forEach((fn) => {
      try {
        fn(s);
      } catch {
        /* lỗi của người nghe không làm hỏng đồng bộ */
      }
    });
  }
  function setState(next, error = null) {
    state = next;
    lastError = error;
    emit();
  }
  /** Đăng ký nghe trạng thái; gọi ngay một lần với trạng thái hiện tại. Trả về hàm hủy. */
  function onStatus(cb) {
    listeners.add(cb);
    try {
      cb(status());
    } catch {
      /* bỏ qua */
    }
    return () => listeners.delete(cb);
  }
  const isOnline = () => nav()?.onLine !== false;
  const fail = (e) => setState(!isOnline() || OFFLINE_CODES.test(String(e?.code || e?.message || "")) ? "offline" : "error", e);

  // ---------- nạp SDK ----------
  function start() {
    if (!isEnabled()) return Promise.reject(err("sync/disabled", "Chưa cấu hình Firebase"));
    ensureHooks();
    if (!sdkPromise) {
      sdkPromise = (async () => {
        try {
          sdk = await loadSdkFn();
        } catch (e) {
          throw err("sync/sdk-load-failed", `Không nạp được Firebase SDK: ${e?.message || e}`);
        }
        const app = sdk.app.initializeApp(config);
        auth = sdk.auth.getAuth(app);
        db = sdk.fs.getFirestore(app);
        if (auth.authStateReady) await auth.authStateReady();
        readMeta();
        if (meta.signOutPending) {
          // lần trước đăng xuất lúc không nạp được SDK: giờ đăng xuất thật
          await sdk.auth.signOut(auth).catch(() => {});
          meta.signOutPending = false;
          writeMeta();
        }
        if (safe(() => session?.getItem(REDIRECT_KEY))) {
          safe(() => session.removeItem(REDIRECT_KEY));
          try {
            await sdk.auth.getRedirectResult(auth);
          } catch (e) {
            lastError = e;
          }
        }
        sdk.auth.onAuthStateChanged(auth, (u) => void handleUser(u));
        await handleEmailLink();
      })().catch((e) => {
        sdkPromise = null;
        throw e;
      });
    }
    return sdkPromise;
  }
  /** Nạp sẵn SDK (gọi khi vẽ màn có nút đăng nhập) để lúc bấm nút mở popup ngay, không bị trình duyệt chặn. */
  async function preload() {
    if (!isEnabled()) return false;
    try {
      await start();
      return true;
    } catch (e) {
      if (currentUser()) fail(e);
      return false;
    }
  }

  async function handleUser(u) {
    readMeta();
    if (u) {
      fbUser = u;
      meta.user = pickUser(u);
      writeMeta();
      if (state === "off") state = "idle";
      emit();
      await syncNow();
    } else {
      fbUser = null;
      if (meta.user && !deleting) unlink(); // bị đăng xuất từ nơi khác / phiên hết hạn: giữ dữ liệu trên máy
      emit();
    }
  }
  /** Tách máy khỏi tài khoản: dữ liệu trên máy trở lại thành dữ liệu khách. Giữ deviceId. */
  function unlink() {
    readMeta();
    clearT(timer);
    timer = null;
    const { deviceId, signOutPending } = meta;
    meta = { ...emptyMeta(), deviceId, signOutPending };
    writeMeta();
    state = "off";
    lastError = null;
  }

  // ---------- khởi động ----------
  const emailLinkInUrl = () => {
    const href = String(loc()?.href || "");
    return /[?&]oobCode=/.test(href) && /[?&]mode=signIn/.test(href);
  };
  /**
   * Gọi MỘT lần lúc mở app (không cần await). Chưa cấu hình → không làm gì. Có phiên đăng nhập cũ / link email / đang quay về
   * từ redirect → nạp SDK, khôi phục phiên, đồng bộ. Còn lại: chờ người dùng bấm đăng nhập mới nạp SDK.
   */
  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!isEnabled()) {
        emit();
        return status();
      }
      readMeta();
      ensureHooks();
      if (meta.user) state = isOnline() ? "idle" : "offline";
      emit();
      if (meta.user || meta.signOutPending || emailLinkInUrl() || safe(() => session?.getItem(REDIRECT_KEY))) {
        try {
          await start();
        } catch (e) {
          if (meta.user) fail(e);
          else lastError = e;
          emit();
        }
      }
      return status();
    })();
    return initPromise;
  }
  let hooked = false;
  function ensureHooks() {
    if (hooked) return;
    hooked = true;
    store.onChange?.(handleChange);
    attachEnv();
  }
  function attachEnv() {
    const w = win();
    const d = docu();
    w?.addEventListener?.("online", () => {
      if (currentUser()) void syncNow();
    });
    w?.addEventListener?.("offline", () => {
      if (currentUser() && state !== "syncing") setState("offline", lastError);
    });
    const onHide = () => {
      if (!currentUser()) return;
      checkPrefs();
      if (hasDirty() && now() - lastPushAt >= HIDDEN_PUSH_GAP_MS) void flush();
    };
    d?.addEventListener?.("visibilitychange", () => {
      if (d.visibilityState === "hidden") onHide();
      else if (currentUser() && now() - lastPullAt >= PULL_GAP_MS) void syncNow();
    });
    w?.addEventListener?.("pagehide", onHide);
    (env.setInterval || ((fn, ms) => g.setInterval?.(fn, ms)))(() => {
      if (currentUser() && d?.visibilityState !== "hidden") checkPrefs();
    }, PREFS_POLL_MS);
  }

  // ---------- đăng nhập ----------
  const isStandalone = () => Boolean(safe(() => win()?.matchMedia?.("(display-mode: standalone)")?.matches)) || nav()?.standalone === true;
  const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(String(nav()?.userAgent || ""));
  /**
   * Redirect chỉ chạy ổn khi authDomain cùng tên miền với app: từ Chrome 115 / Safari 16.1 / Firefox 109 trình duyệt chặn
   * lưu trữ bên thứ ba nên signInWithRedirect qua <project>.firebaseapp.com không trả được kết quả về github.io.
   */
  const redirectSafe = () => Boolean(config?.authDomain) && config.authDomain === loc()?.hostname;
  /**
   * Đăng nhập Google. mode: "auto" (mặc định) | "popup" | "redirect".
   * auto: điện thoại / PWA cài đặt → redirect NẾU authDomain cùng tên miền app, còn lại popup; popup bị chặn thì thử redirect.
   * Trả về { user } (popup) hoặc { redirecting: true } (trang sắp chuyển đi; kết quả có sau khi quay lại, qua onStatus).
   * Ném lỗi có .code (vd auth/popup-closed-by-user, auth/popup-blocked, auth/network-request-failed, sync/disabled).
   */
  async function signInGoogle({ mode = "auto" } = {}) {
    await start();
    const provider = new sdk.auth.GoogleAuthProvider();
    provider.setCustomParameters?.({ prompt: "select_account" });
    const goRedirect = async () => {
      safe(() => session?.setItem(REDIRECT_KEY, "1"));
      await sdk.auth.signInWithRedirect(auth, provider);
      return { redirecting: true };
    };
    if (mode === "redirect" || (mode === "auto" && (isMobile() || isStandalone()) && redirectSafe())) return goRedirect();
    try {
      const res = await sdk.auth.signInWithPopup(auth, provider);
      return { user: pickUser(res.user) };
    } catch (e) {
      if (mode === "auto" && redirectSafe() && /popup-blocked|operation-not-supported/.test(String(e?.code))) return goRedirect();
      throw e;
    }
  }

  /** Gửi link đăng nhập tới email (không mật khẩu). Email được nhớ trên máy này để tự hoàn tất khi mở link. */
  async function sendEmailLink(email) {
    const clean = String(email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw err("auth/invalid-email", "Email không hợp lệ");
    await start();
    const l = loc();
    await sdk.auth.sendSignInLinkToEmail(auth, clean, { url: `${l.origin}${l.pathname}`, handleCodeInApp: true });
    setItem(EMAIL_KEY, clean);
    return { sent: true, email: clean };
  }
  async function handleEmailLink() {
    const href = String(loc()?.href || "");
    if (!emailLinkInUrl() || !sdk.auth.isSignInWithEmailLink(auth, href)) return;
    const email = getItem(EMAIL_KEY);
    if (!email) {
      needEmail = true; // mở link trên máy khác: giao diện hỏi lại email rồi gọi completeEmailLink(email)
      emit();
      return;
    }
    try {
      await finishEmailLink(email);
    } catch (e) {
      lastError = e;
      emit();
    }
  }
  function cleanUrl() {
    const l = loc();
    const h = env.history !== undefined ? env.history : safe(() => g.history);
    safe(() => h?.replaceState?.(null, "", `${l.pathname}${l.hash || ""}`));
  }
  /** Hoàn tất đăng nhập bằng link email (tự gọi khi mở link trên cùng máy; giao diện gọi khi status.needEmail = true). */
  async function completeEmailLink(email) {
    await start();
    return finishEmailLink(email);
  }
  async function finishEmailLink(email) {
    const href = String(loc()?.href || "");
    try {
      const res = await sdk.auth.signInWithEmailLink(auth, String(email || "").trim(), href);
      removeItem(EMAIL_KEY);
      needEmail = false;
      cleanUrl();
      return { user: pickUser(res.user) };
    } catch (e) {
      if (/invalid-action-code|expired-action-code/.test(String(e?.code))) {
        needEmail = false; // link hết hạn / đã dùng: bỏ, người dùng xin link mới
        removeItem(EMAIL_KEY);
        cleanUrl();
        emit();
      }
      throw e;
    }
  }
  /** Bỏ qua link email đang chờ (người dùng bấm Hủy ở hộp hỏi email). */
  function cancelEmailLink() {
    needEmail = false;
    cleanUrl();
    emit();
  }

  /**
   * Đăng xuất. keepLocal = true (mặc định): giữ tiến độ trên máy (thành dữ liệu khách); false: xóa tiến độ + ⭐ trên máy.
   * Trước khi đăng xuất cố đẩy nốt phần chưa ghi (bỏ qua nếu mất mạng).
   */
  async function signOut({ keepLocal = true } = {}) {
    if (!isEnabled()) return;
    readMeta();
    if (meta.user && hasDirty() && isOnline()) await syncNow().catch(() => {});
    let offlineSignOut = false;
    try {
      await start();
      deleting = true; // chặn handleUser(null) xử lý trùng
      await sdk.auth.signOut(auth);
    } catch {
      offlineSignOut = true; // không nạp được SDK: tách máy ngay, đăng xuất thật ở lần nạp sau
    } finally {
      deleting = false;
    }
    fbUser = null;
    meta.signOutPending = offlineSignOut;
    unlink();
    if (!keepLocal) {
      store.resetAll();
      removeItem(UI_PREF_KEY);
    }
    emit();
  }

  /**
   * Xóa toàn bộ dữ liệu đám mây của người đang đăng nhập rồi đăng xuất; tiến độ trên máy GIỮ nguyên.
   * Mặc định xóa luôn tài khoản đăng nhập (email, tên, ảnh trong Firebase Auth); Firebase có thể đòi đăng nhập lại gần đây,
   * khi đó trả về accountDeleted = false (dữ liệu học đã xóa, hồ sơ đăng nhập còn). Cần mạng.
   */
  async function deleteCloudData({ deleteAccount = true } = {}) {
    await start();
    if (!fbUser) throw err("sync/not-signed-in", "Chưa đăng nhập");
    deleting = true;
    clearT(timer);
    try {
      await queue.catch(() => {});
      const { fs } = sdk;
      const uid = fbUser.uid;
      const batch = fs.writeBatch(db);
      for (const lv of M.LEVELS) batch.delete(fs.doc(db, "users", uid, "cards", String(lv)));
      batch.delete(fs.doc(db, "users", uid, "prefs", "ui"));
      batch.delete(fs.doc(db, "users", uid));
      await batch.commit();
      let accountDeleted = false;
      if (deleteAccount) {
        try {
          await sdk.auth.deleteUser(fbUser);
          accountDeleted = true;
        } catch {
          /* auth/requires-recent-login: dữ liệu học đã xóa, hồ sơ đăng nhập còn */
        }
      }
      await sdk.auth.signOut(auth).catch(() => {});
      fbUser = null;
      unlink();
      emit();
      return { deleted: true, accountDeleted };
    } catch (e) {
      fail(e);
      throw e;
    } finally {
      deleting = false;
    }
  }

  // ---------- theo dõi thay đổi ----------
  function handleChange(change) {
    if (applying || !isEnabled()) return;
    readMeta();
    if (!meta.user) return; // khách: không cần sổ, lần đăng nhập đầu sẽ gộp toàn bộ
    const d = meta.dirty;
    const type = change?.type;
    if (type === "remote") return;
    if (type === "card" && M.levelOf(change.id)) d.cards[change.id] = 1;
    else if (type === "card") return;
    else if (type === "xp" || type === "streak") {
      d.p = true;
      if (change.day) d.days[change.day] = 1;
    } else if (type === "unit") {
      d.p = true;
      if (change.key) d.units[change.key] = 1;
    } else if (type === "settings" || type === "stats" || type === "badges") d.p = true;
    else if (type === "reset") {
      meta.resetAt = now(); // "Xóa tiến độ" lúc đang đăng nhập = xóa cả trên mây và ở các máy khác
      meta.base = {};
      meta.dirty = { ...emptyDirty(), replace: true, p: true };
    } else d.all = true; // import / set / không rõ: đẩy lại toàn bộ (gộp)
    writeMeta();
    checkPrefs(false);
    schedule();
    if (state === "idle") emit();
  }
  const readPrefs = () => {
    const p = safe(() => JSON.parse(getItem(UI_PREF_KEY) || "{}"));
    return isObj(p) ? p : {};
  };
  /** Dò tùy chọn giao diện (⭐, lịch sử tìm, tô màu thanh) xem có đổi không; có thì đánh dấu để ghi. */
  function checkPrefs(andSchedule = true) {
    readMeta();
    if (!meta.user) return false;
    const raw = getItem(UI_PREF_KEY) || "";
    if (raw === meta.prefsSnap) return false;
    const p = readPrefs();
    meta.stars = M.trackStars(p.bookmarks, meta.stars, now()).stars;
    meta.prefsAt = now();
    meta.prefsSnap = raw;
    meta.dirty.prefs = true;
    writeMeta();
    if (andSchedule) schedule();
    return true;
  }
  /** Giao diện gọi sau khi đổi ⭐ / lịch sử tìm / tô màu thanh để đồng bộ sớm (không gọi cũng được: tự dò mỗi 30 s). */
  function notifyPrefsChanged() {
    if (isEnabled()) checkPrefs();
  }
  function schedule() {
    if (!fbUser || deleting) return;
    clearT(timer);
    const wait = Math.max(DEBOUNCE_MS, lastPushAt + MIN_PUSH_GAP_MS - now());
    timer = setT(() => void flush(), wait);
  }

  // ---------- kéo + gộp + đẩy ----------
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
  const ref = (...seg) => sdk.fs.doc(db, "users", fbUser.uid, ...seg);

  /** Đồng bộ ngay: kéo dữ liệu mây, gộp với máy, đẩy phần khác biệt. Trả về trạng thái (không ném lỗi; lỗi nằm ở status.error). */
  function syncNow() {
    if (!isEnabled()) return Promise.resolve(status());
    return serial(async () => {
      try {
        if (!sdk || !fbUser) await start();
        if (!fbUser || deleting) return status();
        clearT(timer);
        setState("syncing");
        const remoteProfile = await pull();
        if (remoteProfile !== false) await push(remoteProfile);
        if (fbUser) setState("idle");
      } catch (e) {
        fail(e);
      }
      return status();
    });
  }
  /** Chỉ đẩy phần đã đánh dấu (ghi tự động sau debounce). Vừa "xóa tiến độ" hoặc chưa gộp lần nào thì chạy syncNow. */
  function flush() {
    if (!isEnabled() || !fbUser) return Promise.resolve(status());
    readMeta();
    if (meta.dirty.replace || meta.uid !== fbUser.uid) return syncNow();
    return serial(async () => {
      try {
        if (!fbUser || deleting) return status();
        checkPrefs(false);
        if (!hasDirty()) return status();
        setState("syncing");
        await push(null);
        setState("idle");
      } catch (e) {
        fail(e);
      }
      return status();
    });
  }

  async function pull() {
    const { fs } = sdk;
    const uid = fbUser.uid;
    readMeta();
    const firstLink = meta.uid !== uid;
    const snap = await fs.getDoc(ref());
    const P = snap.exists() ? snap.data() : null;
    if (!P && !firstLink && meta.seen.p) {
      // Dữ liệu mây đã bị xóa từ máy khác (deleteCloudData): không tự đẩy lại, đăng xuất và giữ dữ liệu trên máy
      await sdk.auth.signOut(auth).catch(() => {});
      fbUser = null;
      unlink();
      lastError = err("sync/cloud-deleted", "Dữ liệu đám mây đã bị xóa từ thiết bị khác");
      emit();
      return false;
    }
    const rev = isObj(P?.rev) ? P.rev : {};
    const revC = isObj(rev.c) ? rev.c : {};
    const remoteCards = {};
    const wantLv = [];
    for (const lv of M.LEVELS) {
      const exists = isObj(revC[lv]);
      if (!P || !exists) {
        if (!P || firstLink) remoteCards[lv] = {}; // mây chưa có cấp này: thẻ trên máy cần đẩy
      } else if (firstLink || !sameMap(revC[lv], meta.seen.c[lv])) wantLv.push(lv);
    }
    const wantPrefs = Boolean(P) && isObj(rev.prefs) && (firstLink || !sameMap(rev.prefs, meta.seen.prefs));
    const [cardSnaps, prefsSnap] = await Promise.all([Promise.all(wantLv.map((lv) => fs.getDoc(ref("cards", String(lv))))), wantPrefs ? fs.getDoc(ref("prefs", "ui")) : null]);
    wantLv.forEach((lv, i) => {
      const data = cardSnaps[i].exists() ? cardSnaps[i].data() : null;
      remoteCards[lv] = isObj(data?.c) ? data.c : {};
    });
    const remotePrefs = wantPrefs ? (prefsSnap.exists() ? prefsSnap.data() : null) : !P || firstLink || !isObj(rev.prefs) ? null : undefined;

    // Từ đây chạy đồng bộ một mạch (không await) để thay đổi người dùng vừa tạo trong lúc chờ mạng không bị mất
    checkPrefs(false);
    const local = store.getState();
    const out = M.mergeState(
      local,
      { profile: P, cards: remoteCards, prefs: remotePrefs },
      { deviceId: meta.deviceId, base: firstLink ? {} : meta.base, firstLink, localResetAt: firstLink ? 0 : meta.resetAt, now: now(), ui: { prefs: readPrefs(), stars: meta.stars, prefsAt: meta.prefsAt } },
    );
    if (out.changed) {
      applying = true;
      try {
        store.applyRemote(out.state);
        store.checkStreak?.(now());
      } finally {
        applying = false;
      }
      remoteAppliedAt = now();
    }
    if (out.ui) {
      meta.stars = out.ui.stars;
      meta.prefsAt = out.ui.prefsAt;
      if (out.ui.changed) {
        setItem(UI_PREF_KEY, JSON.stringify(out.ui.prefs));
        remoteAppliedAt = now();
      }
      meta.prefsSnap = getItem(UI_PREF_KEY) || "";
    }
    const d = meta.dirty;
    meta.uid = uid;
    meta.base = out.base;
    meta.resetAt = out.resetAt;
    meta.seen.p = true;
    for (const lv of wantLv) meta.seen.c[lv] = { ...revC[lv] };
    if (wantPrefs) meta.seen.prefs = { ...rev.prefs };
    d.replace = out.replace;
    d.p = d.p || out.push.profile;
    out.push.days.forEach((k) => (d.days[k] = 1));
    out.push.units.forEach((k) => (d.units[k] = 1));
    for (const [lv, ids] of Object.entries(out.push.cards)) {
      if (ids.length > 200) d.lv[lv] = 1; // nhiều thẻ: đánh dấu cả cấp cho gọn sổ
      else ids.forEach((id) => (d.cards[id] = 1));
    }
    d.prefs = d.prefs || out.push.prefs;
    writeMeta();
    lastPullAt = now();
    return P;
  }

  /** Ghi phần đã đánh dấu trong MỘT lô (batch). remoteProfile ≠ null chỉ cần khi ghi đè sau "xóa tiến độ". */
  async function push(remoteProfile) {
    const { fs } = sdk;
    readMeta();
    if (!hasDirty()) {
      meta.lastSyncAt = now();
      writeMeta();
      return;
    }
    const sending = meta.dirty;
    meta.dirty = emptyDirty();
    writeMeta();
    const t = now();
    const dev = meta.deviceId;
    const s = store.getState();
    const batch = fs.writeBatch(db);
    const rev = { c: {}, prefs: {} };
    const full = sending.all || sending.replace;
    try {
      const byLv = {};
      for (const id of Object.keys(sending.cards)) (byLv[M.levelOf(id)] ||= []).push(id);
      for (const lv of M.LEVELS) {
        const cRef = ref("cards", String(lv));
        if (sending.replace) {
          const c = M.cardsPatch(s, lv, "all");
          if (Object.keys(c).length) batch.set(cRef, { v: M.SCHEMA, c, updatedAt: t });
          else batch.delete(cRef);
          rev.c[lv] = { [dev]: t };
        } else if (full || sending.lv[lv] || byLv[lv]) {
          const c = M.cardsPatch(s, lv, full || sending.lv[lv] ? "all" : byLv[lv]);
          if (!Object.keys(c).length) continue;
          batch.set(cRef, { v: M.SCHEMA, c, updatedAt: t }, { merge: true });
          rev.c[lv] = { [dev]: t };
        }
      }
      if (sending.prefs || full) {
        const body = M.prefsDoc({ prefs: readPrefs(), stars: meta.stars, prefsAt: meta.prefsAt }, t);
        if (sending.replace) batch.set(ref("prefs", "ui"), body);
        else batch.set(ref("prefs", "ui"), M.prune(body), { merge: true });
        rev.prefs = { [dev]: t };
      }
      const patch = M.profilePatch(s, {
        deviceId: dev,
        base: meta.base,
        days: full ? "all" : Object.keys(sending.days),
        units: full ? "all" : Object.keys(sending.units),
        resetAt: meta.resetAt,
        now: t,
        name: meta.user?.displayName || "",
      });
      if (sending.replace) {
        // Ghi đè cả hồ sơ; giữ ô nhật ký của các máy khác cho những ngày sau mốc xóa
        const cut = M.dayKey(meta.resetAt);
        for (const [day, e] of Object.entries(isObj(remoteProfile?.days) ? remoteProfile.days : {})) {
          if (!(day > cut) || !isObj(e)) continue;
          const mine = patch.days?.[day] || { x: {}, w: {} };
          (patch.days ||= {})[day] = M.prune({ ...mine, x: { ...(isObj(e.x) ? e.x : {}), ...mine.x }, w: { ...(isObj(e.w) ? e.w : {}), ...mine.w }, f: mine.f || e.f || undefined });
        }
        batch.set(ref(), { ...patch, rev });
      } else batch.set(ref(), M.prune({ ...patch, rev }), { merge: true });
      await batch.commit();
    } catch (e) {
      // Ghi hỏng: trả các dấu "bẩn" về sổ (gộp với dấu mới phát sinh trong lúc chờ)
      const d = meta.dirty;
      d.p = d.p || sending.p;
      d.prefs = d.prefs || sending.prefs;
      d.all = d.all || sending.all;
      d.replace = d.replace || sending.replace;
      for (const k of ["days", "units", "cards", "lv"]) Object.assign(d[k], sending[k]);
      writeMeta();
      throw e;
    }
    for (const [lv, v] of Object.entries(rev.c)) meta.seen.c[lv] = sending.replace ? { ...v } : { ...(meta.seen.c[lv] || {}), ...v };
    if (rev.prefs[dev]) meta.seen.prefs = sending.replace ? { ...rev.prefs } : { ...(meta.seen.prefs || {}), ...rev.prefs };
    meta.seen.p = true;
    meta.lastSyncAt = t;
    lastPushAt = t;
    writeMeta();
    if (hasDirty()) schedule();
  }

  return { isEnabled, init, preload, currentUser, signInGoogle, sendEmailLink, completeEmailLink, cancelEmailLink, signOut, syncNow, flush, onStatus, status, deleteCloudData, notifyPrefsChanged };
}

// ---------- bản mặc định cho app ----------
const main = createSync();
export const isEnabled = main.isEnabled;
export const init = main.init;
export const preload = main.preload;
export const currentUser = main.currentUser;
export const signInGoogle = main.signInGoogle;
export const sendEmailLink = main.sendEmailLink;
export const completeEmailLink = main.completeEmailLink;
export const cancelEmailLink = main.cancelEmailLink;
export const signOut = main.signOut;
export const syncNow = main.syncNow;
export const flush = main.flush;
export const onStatus = main.onStatus;
export const status = main.status;
export const deleteCloudData = main.deleteCloudData;
export const notifyPrefsChanged = main.notifyPrefsChanged;
