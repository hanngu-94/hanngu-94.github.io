# core/ — lõi app HSK 1–9

JS thuần (ES module), **không đụng DOM**, không cần build. Giao diện (`ui/`) chỉ gọi các hàm dưới đây rồi tự vẽ.
Hợp đồng gốc: `docs/PLAN.md` mục 4 (dữ liệu) và mục 5 (API). Test: `node --test tests/` (96 test, fixture 35 từ ở `tests/fixtures/`).

Cấp (`lv`) luôn là 1..7; 7 = băng HSK 7–9 (truyền 8, 9 được quy về 7).

## Bảng hàm

### content.js — dữ liệu
| Hàm | Trả về | Ghi chú |
|---|---|---|
| `loadIndex()` | `Promise<Index>` | đọc `data/vocab/index.json`, có nhớ đệm |
| `loadLevel(lv)` | `Promise<Word[]>` | gộp mọi file của cấp, sắp theo `id` |
| `loadAll()` | `Promise<Word[]>` | nạp cả 7 cấp (10.969 từ, khoảng 0,2 s) |
| `getWord(id)` | `Word \| null` | chỉ thấy từ của cấp đã nạp |
| `search(q, { levels?, limit? })` | `Word[]` | khớp chữ Hán (giản / phồn), pinyin không dấu (`nihao`, `ni3hao3`), nghĩa Việt (có / không dấu), nghĩa Anh; xếp theo độ khớp. `q` rỗng → cả danh sách. Không truyền `limit` → không giới hạn |
| `segment(sentence)` | `string[]` | khớp dài nhất; dấu câu là mảnh riêng, bỏ khoảng trắng |
| `charPinyin(ch)` | `string[]` | cách đọc có dấu của một chữ, cách đọc chính đứng đầu |
| `loadRef(name)` | `Promise<any>` | `data/ref/<name>.json`: `pinyin`, `tones`, `radicals`, `grammar-l1`…, `classifiers` |
| `setFetcher(fn)` | — | thay `fetch` (Node / test). `fn(url)` trả JSON đã parse hoặc đối tượng kiểu `Response` |
| Thêm | | `setBase(url)`, `resetContent()`, `getIndex()`, `levelWords(lv)`, `levelCount(lv)`, `loadedLevels()`, `allWords()`, `findByHanzi(h)`, `isHan(ch)`, `isPunct(s)`, `normLevel(lv)` |

`search`, `segment`, `charPinyin`, `getWord` là hàm đồng bộ, chỉ làm việc trên các cấp **đã nạp**.

### srs.js — lịch ôn (hàm thuần)
| Hàm | Ghi chú |
|---|---|
| `schedule(card \| undefined, grade, now)` → `Card` | grade 0 quên · 1 khó · 2 nhớ · 3 dễ. Trả thẻ mới, không sửa thẻ cũ |
| `strength(card)` → `"new" \| "learning" \| "known" \| "mastered"` | theo `iv`: < 4 ngày · < 21 ngày · còn lại |
| Thêm | `newCard(now)`, `isDue(card, now)`, `STRENGTH_LABEL.vi / .en`, `DAY` |

`Card = { r, iv, ef, due, l, last, seen, right, wrong }` (`iv` tính bằng ngày, `due` / `last` là ms).

### store.js — trạng thái người học (localStorage, khóa `hsk-v2-state`)
| Hàm | Ghi chú |
|---|---|
| `getState()` | object trạng thái: `settings, xp, streak, bestStreak, lastActive, freezes, history, cards, units, badges, stats` |
| `set(patch)` | gộp nông; riêng `settings` gộp từng khóa và kiểm giá trị |
| `subscribe(fn)` → hàm hủy | gọi `fn(state)` sau mỗi lần lưu |
| `addXp(n, words)` → `{ streakUp, goalReached, streak, todayXp }` | |
| `checkStreak()` → chuỗi hiện tại | gọi khi mở app |
| `review(id, grade)` → `Card` | chấm thẻ bằng `srs.schedule` rồi lưu |
| `dueIds()` → `string[]` | thẻ đến hạn, hạn cũ nhất trước |
| `finishUnit(lv, u, acc)` → số sao 1..3 | `acc` 0..1 |
| `nextUnit(lv, total)` → chỉ số bài (từ 0) | |
| `checkBadges()` → huy hiệu vừa mở `[{ id, icon, name, nameEn, desc, descEn }]` | |
| `exportJson()`, `importJson(s)`, `resetAll()` | `importJson` ném lỗi nếu sai định dạng |
| `onChange(fn)` → hàm hủy | móc cho đồng bộ: `fn(change, state)` sau mỗi lần lưu; `change.type` = `card` (kèm `id`) · `xp` (kèm `day`) · `streak` · `unit` (kèm `key`) · `settings` · `stats` · `badges` · `set` · `import` · `reset` · `remote` |
| `applyRemote(state)` | thay cả state bằng bản đã gộp với đám mây (chỉ `core/sync.js` gọi) |
| Thêm | `setSettings(patch)`, `getSettings()`, `todayXp()`, `dayKey()`, `card(id)`, `strengthOf(id)`, `introduce(id, mistakes)`, `learnedIds()`, `unitResult(lv, u)`, `bumpStat(name)`, `recordTest(percent)`, `BADGES`, `SETTING_DEFAULTS`, `setStorage(s)`, `migrate(raw)` |

`state.settingsAt` = mốc (ms) lần cuối đổi cài đặt, dùng khi gộp hai máy.
`state.settings = { uiLang:"vi"|"en", gloss:"vi"|"en"|"both", pinyin:"always"|"hint"|"off", speed:"slow"|"normal"|"fast", voice, sound, theme:"auto"|"light"|"dark", dailyGoal, level }`.
Dữ liệu bản v0 (khóa cũ `level, dailyGoal, speed, voice, showPinyin, sound`) tự chuyển vào `settings`; thẻ / bài mã cũ `hsk1-0001` cất ở `state.legacyV1`, không xóa.

### lesson.js — chia bài, sinh câu hỏi, chấm
| Hàm | Ghi chú |
|---|---|
| `UNIT_SIZE` = 8, `unitsOf(lv)`, `unitWords(lv, u)` | `u` từ 0 |
| `lessonPlan(words, pool, opts?)` | bài học mới: làm quen → ghép cặp → củng cố → sắp xếp, nói, viết |
| `reviewPlan(words, pool, strengthOf, opts?)` | `strengthOf(id)`; nhớ càng chắc dạng càng khó |
| `drillPlan(type, words, pool)` | một dạng bài |
| `placementPlan()` | 15 câu trắc nghiệm trải cấp 1→7, mỗi câu có `meta.lv`. Phải `loadAll()` trước |
| `placementResult(answers)` → cấp 1..7 | `answers`: `[{ lv, correct }]` hoặc `[{ question, correct }]` / `[{ q, correct }]` |
| `testPlan(lv, n = 20, opts?)` | đề thi thử, chỉ dạng tự chấm được |
| `check(question, response)` → `{ correct, note?, noteEn?, … }` | xem bảng dưới |
| Thêm | `makeQuestion(type, word, { pool?, group? })`, `canDo(type, word)`, `retryQuestion(q, word, pool)`, `distractors(...)`, `sentenceTiles(zh)`, `placementDetail(answers)`, `TYPES`, `TYPE_LABEL[type].vi / .en` |

`opts` tắt dạng bài theo thiết bị, vd `{ speak: false, listen: false, write: false }`.
`pool` = danh sách từ để lấy phương án nhiễu (thường là cả cấp); nhiễu ưu tiên cùng cấp, cùng từ loại, cùng độ dài.

**Hình dạng Question theo type** (object thuần, `JSON.stringify` được):

| type | prompt | options | answer | response đưa vào `check` |
|---|---|---|---|---|
| `meaning` | `zh, py, audio` | `{ key, label, vi, en }` | key đúng | key (hoặc `{ key }`, hoặc chỉ số) |
| `hanzi` | `vi, en` | `{ key, label, zh, py }` | key đúng | như trên |
| `listen` | `audio` | `{ key, label, zh, py }` | key đúng | như trên |
| `tone` | `zh, vi, en, audio` | `{ key, label }` (pinyin) | key đúng | như trên |
| `fill` | `sentence, blanks:[{ start, length }], vi, en` | `{ key, label, zh, py }` | key đúng | như trên. `meta.parts` = câu cắt quanh chỗ trống, `meta.py` |
| `typing` | `zh, vi, en, audio` | — | pinyin có dấu | chuỗi gõ: không dấu / có dấu / số thanh. Sai thanh vẫn đúng, kèm `note` + `toneError` |
| `match` | `{}` | cột trái `{ key, label, zh, py }` | `{ keyTrái: keyPhải }` | số lần ghép sai (hoặc `{ mistakes }`, hoặc `[[keyTrái, keyPhải]]`). Cột phải ở `meta.right`; đúng khi sai ≤ `meta.maxMistakes` (1) |
| `order` | `vi, en` | mảnh `{ key, label, zh }` đã xáo | chuỗi ghép đúng | mảng key (hoặc mảng nhãn, hoặc chuỗi). `meta.zh, meta.py, meta.tiles` |
| `speak` | `zh, py, vi, en, audio` | — | chữ Hán | `{ alternatives }` (core tự chấm) · `{ score }` · `{ skipped: true }`. Đạt từ `meta.passScore` (70) |
| `write` | `py, vi, en, audio` | — | mảng chữ cần viết (≤ 3) | số nét sai (hoặc `{ mistakes }`) · `{ skipped: true }`. Đạt khi ≤ `meta.maxMistakes` |

`prompt.audio` là **chữ cần đọc** (đưa cho `speak`); file mp3 nếu có nằm ở `meta.audioUrl`. Mọi câu có `qid`, `wordIds`, `meta.lv`.
`label` của phương án nghĩa = nghĩa Việt, từ chưa có tiếng Việt thì dùng nghĩa Anh rút gọn; UI muốn song ngữ thì đọc `vi` / `en`.

### scoring.js
`scorePronunciation(target, alternatives, charPinyin)` → `{ score 0..100, chars:[{ ch, status:"ok"|"tone"|"bad" }], heard }`. Chữ đồng âm cùng thanh tính đúng; đúng âm sai thanh được nửa điểm.

### speech.js (dùng `window`, không dùng DOM; import trong Node không lỗi)
| Hàm | Ghi chú |
|---|---|
| `speak(text, { rate?, lang?, audioUrl?, voice? })` → `Promise` | có `audioUrl` thì phát mp3, lỗi thì dùng giọng máy. `rate` mặc định theo `settings.speed` |
| `stopSpeaking()` | |
| `chineseVoices()` → `SpeechSynthesisVoice[]` | |
| `canRecognize()`, `canSpeak()` | |
| `listen({ timeoutMs?, lang?, record? })` → `Promise<{ alternatives, audioUrl? }>` | lỗi: `Error` có `.code` (`unsupported`, `not-allowed`, `no-speech`, `network`) và `.messageEn` |

### pinyin.js
`stripTones`, `normalizeTyped`, `toneSequence`, `toneOfSyllable`, `hasToneMarks`, `splitSyllables`, `toneVariants`, `fixUmlaut`, `foldVi`, `isHan`, `shuffle`, `TONE_NAMES`, `TONE_NAMES_EN`.

## Ví dụ dùng

```js
import * as content from "./core/content.js";
import * as store from "./core/store.js";
import * as lesson from "./core/lesson.js";
import { speak, listen } from "./core/speech.js";

// 1. Một bài học
const lv = store.getState().settings.level;
const pool = await content.loadLevel(lv);
const u = store.nextUnit(lv, lesson.unitsOf(lv));
const words = lesson.unitWords(lv, u);
const plan = lesson.lessonPlan(words, pool, { speak: false });

let right = 0;
for (const q of plan) {
  if (q.prompt.audio) speak(q.prompt.audio, { audioUrl: q.meta.audioUrl || undefined });
  const response = await hoiNguoiHoc(q);          // UI tự vẽ theo q.type, trả key / chuỗi / số lần sai
  const { correct, note } = lesson.check(q, response);
  if (correct) right += 1;
}
store.finishUnit(lv, u, right / plan.length);       // → số sao
words.forEach((w) => store.introduce(w.id, 0));     // đưa từ vào lịch ôn
store.addXp(20, words.length);
store.checkBadges();

// 2. Ôn tập
const due = store.dueIds().map(content.getWord).filter(Boolean);
const review = lesson.reviewPlan(due, pool, store.strengthOf);
// sau mỗi câu: store.review(id, correct ? 2 : 0)

// 3. Xếp lớp
await content.loadAll();
const qs = lesson.placementPlan();
const answers = qs.map((q) => ({ question: q, correct: lesson.check(q, traLoi(q)).correct }));
store.set({ settings: { level: lesson.placementResult(answers) } });

// 4. Tra cứu
content.search("thoi gian", { limit: 20 });         // → [时间, …]
content.segment("我没有时间。");                     // → ["我","没有","时间","。"]
const tones = await content.loadRef("tones");

// 5. Luyện nói
const { alternatives } = await listen();
const r = lesson.check(speakQuestion, { alternatives }); // r.score, r.detail.chars

// 6. Trong Node / test
import { readFile } from "node:fs/promises";
content.setFetcher(async (url) => JSON.parse(await readFile(url, "utf8")));
store.setStorage({ getItem: () => null, setItem() {} });
```

## Tài khoản & đồng bộ (`sync.js`, `sync-merge.js`, `firebase-config.js`)

Tùy chọn. `firebase-config.js` để `FIREBASE_CONFIG = null` thì app chạy như cũ (chế độ khách): `isEnabled()` trả `false`, mọi hàm dưới đây không làm gì, **không nạp gì từ mạng**. Có config: Firebase JS SDK 12.4.0 (app, auth, firestore-lite) nạp lazy từ `www.gstatic.com/firebasejs/` chỉ khi người dùng bấm đăng nhập, đã đăng nhập từ trước, hoặc app mở bằng link email. Cách bật: `docs/FIREBASE-SETUP.md`.

### API cho giao diện (`import * as sync from "./core/sync.js"`)
| Hàm | Trả về | Ghi chú |
|---|---|---|
| `isEnabled()` | `boolean` | `false` → giao diện ẩn hết phần tài khoản |
| `init()` | `Promise<Status>` | gọi **một lần** lúc mở app, **không await** (không chặn khởi động). Khôi phục phiên cũ, xử lý link email / quay về từ redirect, đồng bộ lần đầu |
| `preload()` | `Promise<boolean>` | nạp sẵn SDK. Gọi khi **vẽ** màn có nút đăng nhập, để lúc bấm nút popup mở ngay (nạp SDK sau cú bấm thì trình duyệt chặn popup) |
| `currentUser()` | `{ uid, email, displayName, photoURL } \| null` | đồng bộ, có ngay cả khi offline (nhớ trên máy). Đăng nhập bằng link email thì `displayName` / `photoURL` rỗng |
| `signInGoogle({ mode? })` | `Promise<{ user } \| { redirecting: true }>` | `mode`: `"auto"` (mặc định) · `"popup"` · `"redirect"`. auto = popup; trên điện thoại / PWA cài đặt dùng redirect **nếu** `authDomain` cùng tên miền app (xem FIREBASE-SETUP mục 7). Ném lỗi có `.code` |
| `sendEmailLink(email)` | `Promise<{ sent: true, email }>` | gửi link đăng nhập (không mật khẩu); email được nhớ trên máy để tự hoàn tất khi mở link. Email sai dạng → lỗi `auth/invalid-email` |
| `completeEmailLink(email)` | `Promise<{ user }>` | chỉ cần khi `status.needEmail === true` (mở link trên máy khác máy đã xin link): giao diện hỏi lại email rồi gọi. Sai email → `auth/invalid-email` (cho nhập lại); link hết hạn / đã dùng → `auth/invalid-action-code` (tự bỏ link) |
| `cancelEmailLink()` | — | người dùng bấm Hủy ở hộp hỏi email |
| `signOut({ keepLocal = true })` | `Promise` | đẩy nốt phần chưa ghi rồi đăng xuất. `keepLocal: false` → xóa tiến độ + ⭐ trên máy (dữ liệu đám mây giữ nguyên) |
| `syncNow()` | `Promise<Status>` | kéo + gộp + đẩy ngay. Không ném lỗi; lỗi nằm ở `status.error` |
| `onStatus(cb)` | hàm hủy | gọi `cb(Status)` ngay và mỗi lần trạng thái đổi |
| `status()` | `Status` | đọc trạng thái hiện tại |
| `deleteCloudData({ deleteAccount = true })` | `Promise<{ deleted, accountDeleted }>` | xóa mọi tài liệu của người dùng trên Firestore + tài khoản đăng nhập, rồi đăng xuất; **tiến độ trên máy giữ nguyên**. Cần mạng. `accountDeleted: false` khi Firebase đòi đăng nhập lại gần đây (dữ liệu học vẫn đã xóa) |
| `notifyPrefsChanged()` | — | gọi sau khi đổi ⭐ / lịch sử tìm / tô màu thanh để đồng bộ sớm (không gọi cũng được: lõi tự dò khóa `hsk-v2-ui-prefs` mỗi 30 s) |

`Status = { state, lastSyncAt, user, enabled, needEmail, pending, error, remoteAppliedAt }`
- `state`: `"off"` (chưa cấu hình hoặc chưa đăng nhập) · `"idle"` · `"syncing"` · `"offline"` · `"error"`.
- `lastSyncAt`: ms lần đồng bộ thành công gần nhất (0 = chưa). `pending`: còn thay đổi chưa ghi lên mây.
- `error`: `{ code, message } | null`. Mã hay gặp: `auth/popup-closed-by-user`, `auth/popup-blocked`, `auth/network-request-failed`, `auth/invalid-email`, `auth/invalid-action-code`, `auth/quota-exceeded`, `permission-denied`, `sync/sdk-load-failed`, `sync/cloud-deleted` (dữ liệu mây đã bị xóa từ máy khác → máy này tự đăng xuất, giữ dữ liệu), `sync/disabled`.
- `remoteAppliedAt`: ms lần cuối dữ liệu từ mây làm đổi dữ liệu trên máy. Tiến độ đổi thì `store.subscribe` cũng được gọi; ⭐ / lịch sử tìm đổi thì chỉ có mốc này → giao diện vẽ lại màn đang mở, áp lại ngôn ngữ / giao diện sáng tối.

```js
import * as sync from "./core/sync.js";
sync.init();                                   // lúc mở app, không await
if (sync.isEnabled()) {
  sync.preload();                              // khi vẽ màn tài khoản
  const off = sync.onStatus((s) => veLai(s));  // s.state, s.user, s.lastSyncAt, s.needEmail
  nutGoogle.onclick = () => sync.signInGoogle().catch((e) => baoLoi(e.code));
  nutEmail.onclick = () => sync.sendEmailLink(o.value).then(() => hien("Kiểm tra hộp thư"));
}
```

### Mô hình dữ liệu Firestore (3 loại tài liệu, tối đa 9 tài liệu / người)
| Tài liệu | Nội dung |
|---|---|
| `users/{uid}` | hồ sơ: `v, name, level, settings{8 khóa, không có voice}, settingsAt, onboarded, xp, extraXp, streak, bestStreak, lastActive, freezes, days, units, badges, stats, createdAt, resetAt, rev, updatedAt` |
| `users/{uid}/cards/{1..7}` | `{ v, c: { "<id>": [r, iv, ef, due, l, last, seen, right, wrong] }, updatedAt }`: thẻ SRS gộp theo cấp, mỗi thẻ là mảng 9 số (khoảng 81 byte). Cấp lớn nhất 5.606 thẻ ≈ 455 KB < 900 KB |
| `users/{uid}/prefs/ui` | `{ v, stars: { "<id>": ±ms }, searchHistory[≤ 8], toneColors, prefsAt, updatedAt }`; `stars` dương = đang gắn sao, âm = đã bỏ sao (mốc thời gian) |

- `days["YYYY-MM-DD"] = { x: { <máy>: xp }, w: { <máy>: số từ }, f? }`: nhật ký ngày **tách theo máy**; mỗi máy chỉ ghi ô của mình, tổng ngày = cộng các máy → hai máy cùng học một ngày được cộng đúng một lần. `units["lv-u"] = [stars, best, at]`. `extraXp` = XP cũ không có nhật ký (bản v0).
- `rev = { c: { <lv>: { <máy>: ms } }, prefs: { <máy>: ms } }`: mốc ghi của từng tài liệu con. Mỗi lần kéo chỉ đọc hồ sơ (1 lượt đọc), tài liệu con nào có mốc khác lần trước mới đọc thêm.
- Ghi: gom thay đổi, ghi sau khi ngừng thao tác ≥ 8 s **và** cách lần ghi trước ≥ 120 s (app xuống nền: ≥ 20 s), mỗi lần là một lô (batch) gồm hồ sơ + các tài liệu có đổi, chỉ gửi trường đổi (`setDoc merge`). Không dùng listener thời gian thực. Kéo: lúc mở app, lúc quay lại app sau ≥ 10 phút, và khi gọi `syncNow()`.
- Ước lượng mỗi người / ngày (1 thiết bị, học khoảng 15 phút, mở app 3 lần): khoảng 3–6 lượt đọc, 6–16 lượt ghi (mỗi lô 2 lượt: hồ sơ + thẻ một cấp). Số đo trong test: đồng bộ không có gì đổi = 1 đọc / 0 ghi; một buổi học = 0 đọc / 2 ghi; lần đăng nhập đầu = 1 đọc / 4 ghi.
- Sổ đồng bộ trên máy: localStorage `hsk-v2-sync-meta` (mã máy ngẫu nhiên, người dùng, phần chưa ghi, mốc đã thấy); `hsk-v2-sync-email` (email chờ link).

### Quy tắc gộp (`sync-merge.js`, hàm thuần — test `tests/sync-merge.test.mjs`, luồng với Firebase giả `tests/sync-flow.test.mjs`)
| Phần | Quy tắc |
|---|---|
| Thẻ SRS | từng thẻ: bản có `last` (lần ôn cuối) mới hơn thắng; hòa → bản nhiều lượt ôn (`seen`) hơn; hòa nữa → bản trên máy. Thẻ đã có sẵn `last` nên không thêm trường mới |
| XP | cộng nhật ký ngày theo từng máy + `extraXp` (lấy max). Lần **đầu** một máy gộp với tài khoản (dữ liệu khách, bản sao lưu nhập lại): ngày trùng lấy **max**, không cộng → không bao giờ cộng đôi |
| Chuỗi ngày | tính lại từ lịch ngày đã gộp (ngày đóng băng nối chuỗi, không cộng); `bestStreak` = max |
| Huy hiệu | hợp, giữ mốc mở sớm nhất. Bài đã xong: sao / điểm cao nhất. Thống kê: max từng bộ đếm |
| Cài đặt | cả bộ theo `settingsAt` mới hơn; lần đầu máy vào tài khoản đã có cài đặt thì bản trên mây thắng; `voice` giữ theo máy |
| ⭐ | hợp hai máy; cùng một từ thì thao tác mới hơn thắng (bỏ sao sau thì vẫn là bỏ). Lịch sử tìm: bản mới đứng trước, tối đa 8. Tô màu thanh: bản mới hơn |
| Xóa tiến độ | `store.resetAll()` lúc **đang đăng nhập** = xóa cả trên mây và ở các máy khác (ghi `resetAt`, dữ liệu cũ hơn mốc bị bỏ). Lúc là khách thì chỉ xóa trên máy, đăng nhập sau đó không làm mất dữ liệu mây |

Test với SDK / kho lưu giả: `createSync({ store, config, storage, session, loadSdk, env })` trả về bộ hàm như trên.
