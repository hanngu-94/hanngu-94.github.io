// Gộp dữ liệu máy ↔ đám mây. HÀM THUẦN: không mạng, không DOM, không localStorage (test: tests/sync-merge.test.mjs).
// Dạng tài liệu Firestore (xem core/README.md mục "Tài khoản & đồng bộ"):
//   users/{uid}             hồ sơ: settings, days (nhật ký XP theo ngày, tách theo máy), units, badges, stats, rev…
//   users/{uid}/cards/{lv}  { c: { "<id>": [r, iv, ef, due, l, last, seen, right, wrong] } }  (thẻ SRS gộp theo cấp)
//   users/{uid}/prefs/ui    { stars: { "<id>": ±ms }, searchHistory, toneColors, prefsAt }
import { DAY } from "./srs.js";

export const SCHEMA = 1;
export const CARD_FIELDS = ["r", "iv", "ef", "due", "l", "last", "seen", "right", "wrong"];
/** Cài đặt được đồng bộ. `voice` (voiceURI) phụ thuộc thiết bị nên giữ riêng từng máy. */
export const SYNCED_SETTINGS = ["uiLang", "gloss", "pinyin", "speed", "sound", "theme", "dailyGoal", "level"];
export const LEVELS = [1, 2, 3, 4, 5, 6, 7];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const obj = (v) => (isObj(v) ? v : {});

// ---------------- Thẻ SRS ----------------

/** "n3-0012" → 3; mã lạ → 0 (thẻ mã lạ chỉ ở trên máy, không đồng bộ). */
export function levelOf(id) {
  const m = /^n([1-7])-\d{4}$/.exec(String(id));
  return m ? Number(m[1]) : 0;
}

/** Thẻ → mảng 9 số (đỡ khoảng 40% dung lượng tài liệu so với object). */
export const packCard = (c) => CARD_FIELDS.map((k) => num(c?.[k]));

/** Mảng 9 số (hoặc object thẻ kiểu cũ) → thẻ; sai dạng → null. */
export function unpackCard(a) {
  if (Array.isArray(a)) {
    const c = {};
    CARD_FIELDS.forEach((k, i) => (c[k] = num(a[i])));
    if (!c.ef) c.ef = 2.5;
    return c;
  }
  return isObj(a) ? { ...a } : null;
}

/** Mốc sửa cuối của thẻ = `last` (mọi thẻ do srs.schedule tạo đều có; store chỉ sửa thẻ qua schedule nên không cần trường riêng). */
export const cardAt = (c) => num(c?.last);

export const sameCard = (a, b) => Boolean(a) && Boolean(b) && CARD_FIELDS.every((k) => num(a[k]) === num(b[k]));

/** Lấy bản mới hơn: mốc sửa cuối lớn hơn → nhiều lượt ôn hơn → bản trên máy (a). */
export function mergeCard(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const ta = cardAt(a);
  const tb = cardAt(b);
  if (ta !== tb) return ta > tb ? a : b;
  return num(b.seen) > num(a.seen) ? b : a;
}

/**
 * Gộp thẻ. `remoteByLevel` = { lv: { id: thẻ đã đóng gói } } CHỈ gồm các cấp vừa tải về;
 * thẻ trên máy thuộc cấp không tải thì giữ nguyên, không tính là cần đẩy.
 * Trả về { cards, push: { lv: [id cần đẩy lên] }, pulled: số thẻ trên máy bị thay / thêm }.
 */
export function mergeCards(local, remoteByLevel, { dropLocalBefore = 0, dropRemoteBefore = 0 } = {}) {
  const cards = {};
  const push = {};
  let pulled = 0;
  const fetched = new Set(Object.keys(obj(remoteByLevel)).map(Number));
  for (const [id, c] of Object.entries(obj(local))) {
    if (!isObj(c)) continue;
    const lv = levelOf(id);
    if (lv && dropLocalBefore && cardAt(c) < dropLocalBefore) {
      pulled += 1; // bị xóa theo lần "xóa tiến độ" mới hơn ở máy khác
      continue;
    }
    cards[id] = c;
  }
  for (const lv of fetched) {
    const remote = obj(remoteByLevel[lv]);
    const ids = [];
    for (const [id, packed] of Object.entries(remote)) {
      if (levelOf(id) !== lv) continue;
      const r = unpackCard(packed);
      if (!r || (dropRemoteBefore && cardAt(r) < dropRemoteBefore)) continue;
      const l = cards[id];
      const win = mergeCard(l, r);
      if (win === r) {
        if (!l || !sameCard(l, r)) pulled += 1;
        cards[id] = l && sameCard(l, r) ? l : r;
      } else if (!sameCard(l, r)) ids.push(id);
    }
    for (const id of Object.keys(cards)) if (levelOf(id) === lv && !(id in remote)) ids.push(id);
    if (ids.length) push[lv] = ids;
  }
  return { cards, push, pulled };
}

// ---------------- Nhật ký ngày, XP, chuỗi ----------------

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dayNum = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
};
const sumOthers = (map, deviceId) =>
  Object.entries(obj(map)).reduce((t, [dev, v]) => (dev === deviceId ? t : t + Math.max(0, num(v))), 0);

/**
 * Gộp nhật ký ngày KHÔNG cộng đôi. Trên đám mây mỗi ngày tách theo máy: days[day] = { x: { máy: xp }, w: { máy: số từ }, f? }.
 * Mỗi máy chỉ ghi ô của mình (bộ đếm chỉ tăng), tổng ngày = cộng các máy.
 *   phần của máy này = max(ô của máy này trên mây, tổng trên máy − base[day])   với base = phần của CÁC MÁY KHÁC ở lần gộp trước.
 * `firstLink` (lần đầu máy này gộp với tài khoản, dữ liệu máy chưa rõ nguồn: khách, bản sao lưu nhập lại…): base = phần các
 * máy khác đang có trên mây, tức ngày trùng lấy MAX chứ không cộng → không bao giờ cộng đôi.
 * Trả về { history, base, push: [ngày cần ghi ô của máy này], mine: { day: [xp, words] } }.
 */
export function mergeDays(history, remoteDays, { deviceId, base = {}, firstLink = false } = {}) {
  const local = obj(history);
  const remote = obj(remoteDays);
  const out = {};
  const nextBase = {};
  const mineAll = {};
  const push = [];
  for (const day of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    if (!DAY_RE.test(day)) continue;
    const l = obj(local[day]);
    const r = obj(remote[day]);
    const others = [sumOthers(r.x, deviceId), sumOthers(r.w, deviceId)];
    const mineRemote = [Math.max(0, num(obj(r.x)[deviceId])), Math.max(0, num(obj(r.w)[deviceId]))];
    const b = firstLink ? others : Array.isArray(base[day]) ? base[day].map(num) : [0, 0];
    const mine = [Math.max(mineRemote[0], num(l.xp) - b[0], 0), Math.max(mineRemote[1], num(l.words) - b[1], 0)];
    const entry = { xp: mine[0] + others[0], words: mine[1] + others[1] };
    const frozen = Boolean(l.frozen) || Boolean(r.f);
    if (frozen) entry.frozen = true;
    out[day] = entry;
    if (others[0] || others[1]) nextBase[day] = others;
    mineAll[day] = mine;
    const hasLocal = day in local;
    if (mine[0] !== mineRemote[0] || mine[1] !== mineRemote[1] || (frozen && !r.f) || (hasLocal && !(day in remote))) push.push(day);
  }
  return { history: out, base: nextBase, push, mine: mineAll };
}

/**
 * Tính lại chuỗi ngày từ lịch: đi lùi từ ngày hoạt động cuối; ngày có mục thì +1, ngày "đóng băng" (frozen, 0 XP) chỉ nối
 * chuỗi không cộng, thiếu ngày thì dừng. Có `now`: lỡ quá 2 ngày (hoặc lỡ 2 ngày mà hết đóng băng) → chuỗi 0, giống store.checkStreak.
 * Trả về { streak, lastActive, best } (best = chuỗi dài nhất trong lịch).
 */
export function streakFrom(history, { now = 0, freezes = 1 } = {}) {
  const days = new Map();
  for (const [k, e] of Object.entries(obj(history))) if (DAY_RE.test(k) && isObj(e)) days.set(dayNum(k), e);
  if (!days.size) return { streak: 0, lastActive: "", best: 0 };
  const bridge = (e) => Boolean(e.frozen) && !num(e.xp);
  const nums = [...days.keys()].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const n of nums) {
    if (prev === null || n - prev !== 1) run = 0;
    if (!bridge(days.get(n))) run += 1;
    best = Math.max(best, run);
    prev = n;
  }
  const last = nums[nums.length - 1];
  let streak = 0;
  for (let n = last; days.has(n); n -= 1) if (!bridge(days.get(n))) streak += 1;
  const lastActive = Object.keys(history).find((k) => DAY_RE.test(k) && dayNum(k) === last) || "";
  if (now) {
    const gap = dayNum(dayKey(now)) - last;
    if (gap > 2 || (gap === 2 && freezes <= 0)) streak = 0;
  }
  return { streak, lastActive, best };
}

const sumXp = (history) => Object.values(obj(history)).reduce((t, e) => t + num(e?.xp), 0);
/** XP không nằm trong nhật ký ngày (dữ liệu bản v0 chuyển sang). */
export const extraXpOf = (state) => Math.max(0, num(state?.xp) - sumXp(state?.history));

// ---------------- Bài, huy hiệu, thống kê, cài đặt ----------------

const packUnit = (u) => [num(u?.stars), num(u?.best), num(u?.at)];
const unpackUnit = (a) => (Array.isArray(a) ? { stars: num(a[0]), best: num(a[1]), at: num(a[2]) } : isObj(a) ? { stars: num(a.stars), best: num(a.best), at: num(a.at) } : null);

export function mergeUnits(local, remote, { dropLocalBefore = 0, dropRemoteBefore = 0 } = {}) {
  const units = {};
  const push = [];
  const r = {};
  for (const [k, v] of Object.entries(obj(remote))) {
    const u = unpackUnit(v);
    if (u && !(dropRemoteBefore && u.at < dropRemoteBefore)) r[k] = u;
  }
  for (const [k, v] of Object.entries(obj(local))) if (isObj(v) && !(dropLocalBefore && num(v.at) < dropLocalBefore)) units[k] = v;
  for (const k of new Set([...Object.keys(units), ...Object.keys(r)])) {
    const a = units[k];
    const b = r[k];
    if (!a) units[k] = b;
    else if (b) units[k] = { stars: Math.max(num(a.stars), b.stars), best: Math.max(num(a.best), b.best), at: Math.max(num(a.at), b.at) };
    const m = units[k];
    if (!b || m.stars !== b.stars || m.best !== b.best || m.at !== b.at) push.push(k);
  }
  return { units, push };
}

/** Hợp huy hiệu, giữ mốc mở sớm nhất. */
export function mergeBadges(local, remote, { dropLocalBefore = 0, dropRemoteBefore = 0 } = {}) {
  const out = {};
  const add = (src, before) => {
    for (const [id, ts] of Object.entries(obj(src))) {
      const t = num(ts);
      if (!t || (before && t < before)) continue;
      out[id] = out[id] ? Math.min(out[id], t) : t;
    }
  };
  add(local, dropLocalBefore);
  add(remote, dropRemoteBefore);
  return out;
}

/** Bộ đếm thống kê: lấy giá trị lớn hơn từng khóa (không cộng, tránh đếm đôi). */
export function mergeStats(local, remote) {
  const out = { ...obj(local) };
  for (const [k, v] of Object.entries(obj(remote))) out[k] = Math.max(num(out[k]), num(v));
  return out;
}

const pickSynced = (s) => Object.fromEntries(SYNCED_SETTINGS.filter((k) => obj(s)[k] !== undefined).map((k) => [k, s[k]]));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (o) => Object.fromEntries(Object.entries(obj(o)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * Cài đặt: bản có `settingsAt` mới hơn thắng (cả bộ). Riêng lần đầu máy này gộp với tài khoản đã có cài đặt trên mây
 * (`firstLink`) thì bản trên mây thắng, để cài đặt vừa chọn ở màn chào trên máy mới không đè cài đặt quen dùng.
 */
export function mergeSettings(local, localAt, remote, remoteAt, { firstLink = false } = {}) {
  const l = obj(local);
  const la = num(localAt);
  const ra = num(remoteAt);
  if (!isObj(remote) || !Object.keys(remote).length) return { settings: l, settingsAt: la, push: true };
  const r = pickSynced(remote);
  if (firstLink || ra > la) return { settings: { ...l, ...r }, settingsAt: ra, push: false };
  return { settings: l, settingsAt: la, push: la > ra || !sameJson(sorted(pickSynced(l)), sorted(r)) };
}

// ---------------- ⭐, lịch sử tìm, tô màu thanh (khóa localStorage hsk-v2-ui-prefs của ui/) ----------------

/**
 * So danh sách ⭐ hiện tại với sổ mốc `stars` = { id: +ms (đang gắn sao) | −ms (đã bỏ sao) } để ghi nhận thay đổi.
 * Trả về { stars, changed }.
 */
export function trackStars(bookmarks, stars, now) {
  const list = Array.isArray(bookmarks) ? bookmarks.filter((x) => typeof x === "string") : [];
  const out = { ...obj(stars) };
  let changed = false;
  list.forEach((id, i) => {
    if (!(num(out[id]) > 0)) {
      out[id] = now - i; // giữ thứ tự "mới gắn đứng trước"
      changed = true;
    }
  });
  const on = new Set(list);
  for (const [id, ts] of Object.entries(out)) {
    if (num(ts) > 0 && !on.has(id)) {
      out[id] = -now;
      changed = true;
    }
  }
  return { stars: out, changed };
}

/** Hợp ⭐ của hai máy; cùng một từ thì thao tác mới hơn thắng (bỏ sao sau khi gắn sao thì vẫn là bỏ), hòa → giữ sao. */
export function mergeStars(a, b) {
  const out = {};
  for (const src of [obj(a), obj(b)]) {
    for (const [id, v] of Object.entries(src)) {
      const t = num(v);
      if (!t) continue;
      const cur = num(out[id]);
      if (!cur || Math.abs(t) > Math.abs(cur) || (Math.abs(t) === Math.abs(cur) && t > cur)) out[id] = t;
    }
  }
  return out;
}

export const starList = (stars) =>
  Object.entries(obj(stars))
    .filter(([, t]) => num(t) > 0)
    .sort((x, y) => y[1] - x[1])
    .map(([id]) => id);

/**
 * Gộp tùy chọn giao diện. local = { prefs: object đọc từ localStorage, stars: sổ mốc, prefsAt }, remote = tài liệu prefs/ui | null.
 * Trả về { prefs, stars, prefsAt, push, changed }.
 */
export function mergePrefs(local, remote) {
  const lp = obj(local?.prefs);
  const ls = obj(local?.stars);
  const la = num(local?.prefsAt);
  const r = isObj(remote) ? remote : null;
  const stars = mergeStars(ls, r?.stars);
  const ra = num(r?.prefsAt);
  const remoteNewer = Boolean(r) && ra > la;
  const lh = Array.isArray(lp.searchHistory) ? lp.searchHistory : [];
  const rh = Array.isArray(r?.searchHistory) ? r.searchHistory.filter((x) => typeof x === "string") : [];
  const seen = new Set();
  const searchHistory = (remoteNewer ? [...rh, ...lh] : [...lh, ...rh])
    .filter((q) => {
      const k = String(q).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
  const toneColors = remoteNewer && typeof r.toneColors === "boolean" ? r.toneColors : lp.toneColors !== false;
  const prefs = { ...lp, toneColors, bookmarks: starList(stars), searchHistory };
  const prefsAt = Math.max(la, ra);
  const before = { t: lp.toneColors !== false, b: Array.isArray(lp.bookmarks) ? lp.bookmarks : [], h: lh };
  const changed = !sameJson(before, { t: toneColors, b: prefs.bookmarks, h: searchHistory });
  const push = !r || !sameJson(sorted(stars), sorted(r.stars)) || !sameJson(searchHistory, rh) || toneColors !== (r.toneColors !== false) || prefsAt !== ra;
  return { prefs, stars, prefsAt, push, changed };
}

export const prefsDoc = ({ prefs, stars, prefsAt }, now) => ({
  v: SCHEMA,
  stars: obj(stars),
  searchHistory: Array.isArray(prefs?.searchHistory) ? prefs.searchHistory.slice(0, 8) : [],
  toneColors: prefs?.toneColors !== false,
  prefsAt: num(prefsAt),
  updatedAt: now,
});

// ---------------- Gộp cả trạng thái ----------------

/**
 * Gộp state trên máy với dữ liệu đám mây.
 *   local  = state của core/store.js (kể cả schema cũ thiếu khóa)
 *   remote = { profile: tài liệu users/{uid} | null, cards: { lv: { id: thẻ đóng gói } } (các cấp vừa tải), prefs: tài liệu prefs/ui | null | undefined (không tải) }
 *   opts   = { deviceId, base, firstLink, localResetAt, now, ui: { prefs, stars, prefsAt } }
 * Trả về {
 *   state, base, resetAt, changed (state trên máy có đổi không),
 *   replace (true = máy này vừa "xóa tiến độ" mới hơn mây → ghi đè cả tài liệu thay vì ghi phần đổi),
 *   push: { profile, days: [ngày], units: [khóa], cards: { lv: [id] }, prefs },
 *   mine: { day: [xp, words] } phần của máy này, ui: { prefs, stars, prefsAt, changed } | null }.
 */
export function mergeState(local, remote = {}, opts = {}) {
  const { deviceId = "d0", base = {}, firstLink = false, now = 0 } = opts;
  const L = obj(local);
  const P = isObj(remote?.profile) ? remote.profile : null;
  const localResetAt = num(opts.localResetAt);
  const remoteResetAt = num(P?.resetAt);
  const resetAt = Math.max(localResetAt, remoteResetAt);
  const localWins = localResetAt > remoteResetAt; // máy này xóa tiến độ sau lần ghi cuối của mây
  const remoteWins = remoteResetAt > localResetAt; // máy khác đã xóa tiến độ
  const dropL = remoteWins ? remoteResetAt : 0;
  const dropR = localWins ? localResetAt : 0;
  const cutDays = (days, at) => (at ? Object.fromEntries(Object.entries(obj(days)).filter(([k]) => DAY_RE.test(k) && k > dayKey(at))) : obj(days));

  const cardsOut = mergeCards(L.cards, remote?.cards, { dropLocalBefore: dropL, dropRemoteBefore: dropR });
  const daysOut = mergeDays(cutDays(L.history, dropL), cutDays(P?.days, dropR), { deviceId, base: remoteWins ? {} : base, firstLink });
  const unitsOut = mergeUnits(L.units, P?.units, { dropLocalBefore: dropL, dropRemoteBefore: dropR });
  const badges = mergeBadges(L.badges, P?.badges, { dropLocalBefore: dropL, dropRemoteBefore: dropR });
  const stats = localWins ? { ...obj(L.stats) } : remoteWins ? mergeStats({}, P?.stats) : mergeStats(L.stats, P?.stats);
  const extraXp = localWins ? extraXpOf(L) : remoteWins ? num(P?.extraXp) : Math.max(extraXpOf(L), num(P?.extraXp));
  const set = mergeSettings(L.settings, L.settingsAt, P?.settings, P?.settingsAt, { firstLink });

  // Đóng băng chuỗi: theo máy hoạt động gần hơn; hòa → số nhỏ hơn
  const lf = Number.isFinite(Number(L.freezes)) ? num(L.freezes) : 1;
  let freezes = lf;
  if (P && Number.isFinite(Number(P.freezes))) {
    const la = String(L.lastActive || "");
    const ra = String(P.lastActive || "");
    freezes = ra > la ? num(P.freezes) : ra < la ? lf : Math.min(lf, num(P.freezes));
  }
  const st = streakFrom(daysOut.history, { now, freezes });
  const bestStreak = Math.max(localWins ? 0 : num(P?.bestStreak), remoteWins ? 0 : num(L.bestStreak), st.best);
  const createdAt = Math.min(...[num(L.createdAt), num(P?.createdAt)].filter(Boolean), Infinity);

  const state = {
    ...L,
    settings: set.settings,
    settingsAt: set.settingsAt,
    onboarded: localWins ? Boolean(L.onboarded) : Boolean(L.onboarded) || Boolean(P?.onboarded),
    xp: sumXp(daysOut.history) + extraXp,
    streak: st.streak,
    bestStreak,
    lastActive: st.lastActive,
    freezes,
    history: daysOut.history,
    cards: cardsOut.cards,
    units: unitsOut.units,
    badges,
    stats,
    createdAt: Number.isFinite(createdAt) ? createdAt : now || Date.now(),
  };

  const small = (s) => [s.settings, s.settingsAt || 0, Boolean(s.onboarded), s.xp || 0, s.streak || 0, s.bestStreak || 0, s.lastActive || "", s.freezes, sorted(s.history), sorted(s.units), sorted(s.badges), sorted(s.stats)];
  const changed = cardsOut.pulled > 0 || !sameJson(small(L), small(state));

  const profileDiffers =
    !P ||
    set.push ||
    Boolean(P.onboarded) !== state.onboarded ||
    num(P.extraXp) !== extraXp ||
    num(P.freezes) !== freezes ||
    num(P.bestStreak) !== bestStreak ||
    num(P.resetAt) !== resetAt ||
    !sameJson(sorted(mergeBadges(P.badges, null)), sorted(badges)) ||
    !sameJson(sorted(mergeStats({}, P.stats)), sorted(mergeStats({}, stats)));

  const ui = opts.ui && remote?.prefs !== undefined ? mergePrefs(opts.ui, remote.prefs) : null;
  return {
    state,
    base: daysOut.base,
    resetAt,
    changed,
    replace: localWins && Boolean(P),
    push: {
      profile: profileDiffers || daysOut.push.length > 0 || unitsOut.push.length > 0,
      days: daysOut.push,
      units: unitsOut.push,
      cards: cardsOut.push,
      prefs: Boolean(ui?.push),
    },
    mine: daysOut.mine,
    ui,
  };
}

// ---------------- Dựng tài liệu ghi lên mây ----------------

/** Bỏ các map rỗng: setDoc(…, { merge: true }) coi map rỗng là giá trị lá và sẽ GHI ĐÈ cả nhánh trên mây. */
export function prune(o) {
  if (!isObj(o)) return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    if (isObj(v)) {
      const p = prune(v);
      if (Object.keys(p).length) out[k] = p;
    } else out[k] = v;
  }
  return out;
}

/** Ô nhật ký ngày của MÁY NÀY = tổng trên máy − phần các máy khác (base). */
export function ownDay(state, base, day, deviceId) {
  const e = obj(obj(state?.history)[day]);
  const b = Array.isArray(obj(base)[day]) ? base[day] : [0, 0];
  const d = { x: { [deviceId]: Math.max(0, num(e.xp) - num(b[0])) }, w: { [deviceId]: Math.max(0, num(e.words) - num(b[1])) } };
  if (e.frozen) d.f = true;
  return d;
}

/**
 * Phần hồ sơ cần ghi (dùng với setDoc merge). `days` / `units`: danh sách khóa đổi, hoặc "all".
 * Các trường vô hướng nhỏ (cài đặt, huy hiệu, thống kê…) luôn ghi kèm vì rẻ và giữ hồ sơ nhất quán.
 */
export function profilePatch(state, { deviceId, base = {}, days = [], units = [], resetAt = 0, now, name = "" }) {
  const s = obj(state);
  const dayKeys = days === "all" ? Object.keys(obj(s.history)) : days;
  const unitKeys = units === "all" ? Object.keys(obj(s.units)) : units;
  const patch = {
    v: SCHEMA,
    name: String(name || ""),
    level: num(s.settings?.level) || 1,
    settings: pickSynced(s.settings),
    settingsAt: num(s.settingsAt),
    onboarded: Boolean(s.onboarded),
    xp: num(s.xp),
    extraXp: extraXpOf(s),
    streak: num(s.streak),
    bestStreak: num(s.bestStreak),
    lastActive: String(s.lastActive || ""),
    freezes: num(s.freezes),
    badges: mergeBadges(s.badges, null),
    stats: mergeStats({}, s.stats),
    createdAt: num(s.createdAt),
    resetAt: num(resetAt),
    updatedAt: now,
    days: {},
    units: {},
  };
  for (const d of dayKeys) if (DAY_RE.test(d) && obj(s.history)[d]) patch.days[d] = ownDay(s, base, d, deviceId);
  for (const k of unitKeys) if (obj(s.units)[k]) patch.units[k] = packUnit(s.units[k]);
  return prune(patch);
}

/** Thẻ của một cấp để ghi lên mây: `ids` = danh sách thẻ đổi, hoặc "all". Trả về { id: mảng 9 số }. */
export function cardsPatch(state, lv, ids = "all") {
  const cards = obj(state?.cards);
  const list = ids === "all" ? Object.keys(cards) : ids;
  const c = {};
  for (const id of list) if (levelOf(id) === Number(lv) && isObj(cards[id])) c[id] = packCard(cards[id]);
  return c;
}

/** Ước lượng số byte Firestore tính cho tài liệu thẻ một cấp (giới hạn cứng 1 MiB / tài liệu). */
export function cardsDocBytes(count) {
  return 64 + count * (8 + 1 + CARD_FIELDS.length * 8);
}
