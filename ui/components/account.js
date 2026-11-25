// Giao diện Tài khoản & đồng bộ (GIAO-ANTIGRAVITY-ACCOUNT §§2–5).
// Mọi lời gọi lõi đi qua ui/api.js (A.SY); không nạp Firebase SDK trực tiếp.
import { h, clear, sheet, toast, go, add } from "./dom.js";
import { t, lang, applyLang } from "../i18n.js";
import * as A from "../api.js";

const GOOGLE_G_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.71A5.4 5.4 0 0 1 3.69 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>`;

const ENVELOPE_SVG = `<svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true"><rect x="6" y="13" width="44" height="30" rx="6" stroke="var(--brand)" stroke-width="2.5" fill="var(--brand-soft)"/><path d="M8 16l20 15 20-15" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Đọc trạng thái đồng bộ (hỗ trợ mock chỉ cho chế độ chụp ảnh / tự kiểm UI, không ghi storage). */
export function getSyncStatus() {
  if (typeof window !== "undefined" && window.__ACC_MOCK__) return window.__ACC_MOCK__;
  return A.SY.status();
}

export function isSyncEnabled() {
  if (typeof window !== "undefined" && window.__ACC_MOCK__) return Boolean(window.__ACC_MOCK__.enabled);
  return A.SY.isEnabled();
}

export function getCurrentUser() {
  if (typeof window !== "undefined" && window.__ACC_MOCK__) return window.__ACC_MOCK__.user || null;
  return A.SY.currentUser();
}

/** Tên hiển thị: displayName hoặc phần trước @ của email. */
export function displayNameOf(user) {
  if (!user) return "";
  if (user.displayName && user.displayName.trim()) return user.displayName.trim();
  if (user.email) return user.email.split("@")[0];
  return t("acc.section");
}

/** Ảnh đại diện tròn (48 px hoặc 28 px), lỗi ảnh → chữ cái đầu. */
export function userAvatar(user, size = 48) {
  const name = displayNameOf(user);
  const initial = (name[0] || "?").toUpperCase();
  const cls = size <= 32 ? "acc-avatar.sm" : "acc-avatar";
  const wrap = h(`span.${cls}`, { "aria-hidden": "true" }, initial);
  if (user?.photoURL) {
    const img = h("img", {
      src: user.photoURL,
      alt: "",
      referrerpolicy: "no-referrer",
      onerror: () => {
        img.remove();
        wrap.textContent = initial;
      },
    });
    clear(wrap).append(img);
  }
  return wrap;
}

/** Thời gian tương đối cho dòng trạng thái đồng bộ (§5). */
export function formatRelativeTime(ts) {
  if (!ts || ts <= 0) return "";
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 60) return t("acc.justNow");
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return t("acc.minsAgo", { n: mins });
  const d = new Date(ts);
  const today = new Date(now);
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return t("acc.hoursAgo", { n: Math.floor(mins / 60) });
  const yest = new Date(now - 86400000);
  const hhmm = d.toLocaleTimeString(lang() === "en" ? "en-GB" : "vi-VN", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === yest.toDateString()) return t("acc.yesterdayAt", { time: hhmm });
  return `${d.toLocaleDateString(lang() === "en" ? "en-GB" : "vi-VN", { day: "2-digit", month: "2-digit" })} ${hhmm}`;
}

/** Thông báo lỗi đăng nhập theo mã e.code (§4.1–4.2). */
function mapAuthError(code) {
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return null;
  if (code === "auth/popup-blocked") return t("acc.err.popupBlocked");
  if (code === "auth/network-request-failed" || code === "sync/sdk-load-failed") return t("acc.err.network");
  if (code === "auth/unauthorized-domain") {
    console.warn("[sync] auth/unauthorized-domain");
    return t("acc.err.domain");
  }
  if (code === "auth/invalid-email") return t("acc.err.email");
  if (code === "auth/quota-exceeded") return t("acc.err.quota");
  return t("acc.err.generic");
}

/** Lớp, biểu tượng, chữ của dòng trạng thái theo status (đủ 5 trạng thái §5, luôn có biểu tượng + chữ). */
function syncStatusView(st) {
  if (st.state === "syncing") return { cls: "st-syncing", ico: "↻", spin: true, text: t("acc.statusSyncing") };
  if (st.state === "offline") return { cls: "st-offline", ico: "☁✕", text: t("acc.statusOffline") };
  if (st.state === "error") {
    const isPerm = st.error?.code === "permission-denied";
    return { cls: "st-error", ico: "⚠", retry: true, text: isPerm ? `${t("acc.statusError")}. ${t("acc.statusPerm")}` : t("acc.statusError") };
  }
  // idle
  if (st.pending) return { cls: "st-pending", ico: "●", text: t("acc.statusPending") };
  return { cls: "st-ok", ico: "✓", text: st.lastSyncAt > 0 ? t("acc.statusSynced", { when: formatRelativeTime(st.lastSyncAt) }) : t("acc.statusNever") };
}

/**
 * Cập nhật dòng trạng thái tại chỗ (KCS lần 6 M3): chỉ đổi lớp + chữ, không thay phần tử,
 * nên vùng aria-live đọc ổn định và không làm mất tiêu điểm.
 * Trả về true nếu nút "Thử lại" vừa bị ẩn lúc đang giữ tiêu điểm (nơi gọi đưa tiêu điểm sang nút khác).
 */
export function updateSyncStatus(el, st) {
  const [ico, text, retry] = el.children;
  if (!st || st.state === "off") {
    el.hidden = true;
    return false;
  }
  const v = syncStatusView(st);
  const cls = `acc-status ${v.cls}`;
  if (el.className !== cls) el.className = cls;
  el.hidden = false;
  if (ico.textContent !== v.ico) ico.textContent = v.ico;
  ico.className = v.spin ? "acc-spin" : "acc-ico";
  if (text.textContent !== v.text) text.textContent = v.text;
  const lostFocus = !v.retry && document.activeElement === retry;
  retry.hidden = !v.retry;
  return lostFocus;
}

/** Dòng trạng thái đồng bộ (aria-live="polite"); phần tử cố định, đổi trạng thái bằng updateSyncStatus(). */
export function renderSyncStatus(st, onRetry) {
  if (!st || st.state === "off") return null;
  const el = h(
    "div.acc-status",
    { role: "status", "aria-live": "polite" },
    h("span.acc-ico", { "aria-hidden": "true" }),
    h("span"),
    h("button.link.small.acc-retry", { type: "button", hidden: true, onclick: () => (onRetry ? onRetry() : A.SY.syncNow()) }, t("acc.retry")),
  );
  updateSyncStatus(el, st);
  return el;
}

// Ý định đăng nhập đặt TRƯỚC khi gọi lõi (KCS lần 6 M1): lõi báo có user qua onStatus thường trước khi promise đăng nhập trả về,
// nên chỉ một nơi phát toast (ui/app.js) và lấy lời báo ở đây.
let pendingSignInMsg = null;
export function takeSignInMsg() {
  const v = pendingSignInMsg;
  pendingSignInMsg = null;
  return v;
}

let fieldSeq = 0;
/** id cho cặp label / input (KCS lần 6 L5). */
const fieldId = () => `acc-field-${(fieldSeq += 1)}`;

/** Đổi bước trong cùng hộp thoại: thay nội dung nhưng giữ id của tiêu đề để aria-labelledby của sheet() còn đúng (KCS lần 6 L2). */
function swapStep(host, ...children) {
  const id = host.querySelector("h2")?.id;
  clear(host).append(...children);
  const title = host.querySelector("h2");
  if (id && title) title.id = id;
}

/** Chuẩn hóa chữ xác nhận: bỏ dấu (NFD), bỏ khoảng trắng đầu cuối, viết hoa — XÓA / XOÁ / xóa / XOA đều khớp (KCS lần 6 H1). */
const normWord = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

/** Nút đăng nhập Google + Email + đồng ý Quyền riêng tư (§2 & §3). */
function signedOutBlock() {
  if (!window.__ACC_MOCK__) A.SY.preload(); // §2: gọi preload không await khi vẽ nút đăng nhập
  const msgEl = h("p.acc-msg.small", { role: "status", "aria-live": "polite" });
  const btnGoogle = h(
    "button.btn.wide.btn-google",
    {
      type: "button",
      onclick: () => {
        // §4.1: gọi signInGoogle TRỰC TIẾP trong handler click (không await trước, không setTimeout)
        msgEl.textContent = "";
        msgEl.className = "acc-msg small";
        // Khóa nút làm trình duyệt bỏ tiêu điểm khỏi nút: mở khóa thì trả tiêu điểm lại (nếu người dùng chưa chuyển đi nơi khác)
        const hadFocus = document.activeElement === btnGoogle;
        const unlock = () => {
          btnGoogle.disabled = false;
          if (hadFocus && btnGoogle.isConnected && (!document.activeElement || document.activeElement === document.body)) btnGoogle.focus({ preventScroll: true });
        };
        btnGoogle.disabled = true;
        pendingSignInMsg = "acc.signedInSyncing";
        A.SY.signInGoogle({ mode: "auto" })
          .then((res) => {
            if (res?.redirecting) {
              msgEl.textContent = t("acc.redirecting");
              return;
            }
            unlock();
          })
          .catch((e) => {
            pendingSignInMsg = null;
            unlock();
            const m = mapAuthError(e?.code);
            if (m) {
              msgEl.textContent = m;
              msgEl.classList.add("err");
            }
          });
      },
    },
    h("span.g-logo", { html: GOOGLE_G_SVG }),
    h("span", t("acc.google")),
  );
  const btnEmail = h("button.btn.wide", { type: "button", onclick: () => openEmailSignInSheet() }, "✉️ ", t("acc.email"));
  const iosStandalone = typeof navigator !== "undefined" && navigator.standalone === true;
  return h(
    "div.acc-signed-out",
    h("p.muted.small", t("acc.subtitle")),
    h("div.acc-btn-stack", btnGoogle, iosStandalone ? h("p.muted.small", t("acc.iosHint")) : null, btnEmail),
    msgEl,
    h("p.muted.small.acc-privacy-note", `${t("acc.privacyAgree")} `, h("a.link", { href: "#/privacy" }, t("acc.privacy")), "."),
  );
}

/** Hộp đăng nhập bằng email + màn "Kiểm tra hộp thư" (§4.2). */
export function openEmailSignInSheet({ initialInboxEmail = null } = {}) {
  let close;
  let timer = null;
  const host = h("div.acc-dialog");

  const clearTimer = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  function showForm(prefill = "") {
    clearTimer();
    const id = fieldId();
    const input = h("input.search", {
      id,
      type: "email",
      autocomplete: "email",
      inputmode: "email",
      placeholder: t("acc.emailPlaceholder"),
      value: prefill,
    });
    const errEl = h("p.acc-msg.small.err", { role: "status", "aria-live": "polite" });
    const submitBtn = h("button.btn.primary.wide", { type: "submit" }, t("acc.sendLink"));
    const form = h(
      "form.acc-form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          const email = input.value.trim();
          errEl.textContent = "";
          if (!email) {
            errEl.textContent = t("acc.err.email");
            input.focus();
            return;
          }
          submitBtn.disabled = true;
          submitBtn.textContent = t("acc.sending");
          try {
            await A.SY.sendEmailLink(email);
            showInbox(email);
          } catch (err) {
            submitBtn.disabled = false;
            submitBtn.textContent = t("acc.sendLink");
            errEl.textContent = mapAuthError(err?.code) || t("acc.err.generic");
          }
        },
      },
      h("h2", t("acc.email")),
      h("label.acc-label", { for: id }, t("acc.emailLabel")),
      input,
      errEl,
      submitBtn,
    );
    swapStep(host, form);
    setTimeout(() => input.focus({ preventScroll: true }), 40);
  }

  function showInbox(email) {
    clearTimer();
    let left = 60;
    const resendBtn = h("button.btn.wide", {
      type: "button",
      disabled: true,
      onclick: async () => {
        if (resendBtn.disabled) return;
        resendBtn.disabled = true;
        try {
          await A.SY.sendEmailLink(email);
          toast(t("acc.checkInbox"), "good");
          startCountdown();
        } catch (err) {
          toast(mapAuthError(err?.code) || t("acc.err.generic"), "bad");
          resendBtn.disabled = false;
        }
      },
    }, t("acc.resendWait", { s: left }));
    const startCountdown = () => {
      clearTimer();
      left = 60;
      resendBtn.disabled = true;
      resendBtn.textContent = t("acc.resendWait", { s: left });
      timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearTimer();
          resendBtn.disabled = false;
          resendBtn.textContent = t("acc.resend");
        } else {
          resendBtn.textContent = t("acc.resendWait", { s: left });
        }
      }, 1000);
    };
    startCountdown();
    const parts = t("acc.checkInboxBody", { email: "\u0000" }).split("\u0000");
    const otherBtn = h("button.btn.ghost.wide", { type: "button", onclick: () => showForm(email) }, t("acc.otherEmail"));
    const swapped = host.isConnected;
    swapStep(
      host,
      h("div.acc-inbox", h("div.acc-envelope", { html: ENVELOPE_SVG }), h("h2", t("acc.checkInbox")), h("p", parts[0], h("strong", email), parts[1] || ""), h("p.muted.small", t("acc.spamHint")), h("div.acc-btn-stack", resendBtn, otherBtn)),
    );
    // Nút "Gửi link" vừa bấm đã bị gỡ: đưa tiêu điểm vào nút còn bấm được, không để rơi về body (KCS lần 6 L2)
    if (swapped) otherBtn.focus({ preventScroll: true });
  }

  if (initialInboxEmail) showInbox(initialInboxEmail);
  else showForm();

  close = sheet(host, { onClose: clearTimer });
  return close;
}

/** Hộp "Xác nhận email" khi mở link trên thiết bị khác (§4.3). */
export function openConfirmEmailSheet({ onDismiss } = {}) {
  let close;
  // settled = đã xong việc với link (xác nhận xong / link hết hạn / đã báo lõi hủy). Đóng bằng Hủy, Esc, ✕, bấm nền, đổi route
  // mà chưa settled thì báo lõi hủy link, nếu không needEmail kẹt true (KCS lần 6 M4a).
  let settled = false;
  const id = fieldId();
  const input = h("input.search", {
    id,
    type: "email",
    autocomplete: "email",
    inputmode: "email",
    placeholder: t("acc.emailPlaceholder"),
  });
  const errEl = h("p.acc-msg.small.err", { role: "status", "aria-live": "polite" });
  const confirmBtn = h("button.btn.primary.wide", { type: "submit" }, t("acc.confirm"));
  const cancelBtn = h("button.btn.wide", {
    type: "button",
    onclick: () => close(),
  }, t("acc.cancel"));
  const form = h(
    "form.acc-dialog.acc-form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        const email = input.value.trim();
        errEl.textContent = "";
        if (!email) {
          errEl.textContent = t("acc.err.email");
          input.focus();
          return;
        }
        confirmBtn.disabled = true;
        pendingSignInMsg = "acc.signedIn";
        try {
          await A.SY.completeEmailLink(email);
          settled = true;
          close();
        } catch (err) {
          pendingSignInMsg = null;
          confirmBtn.disabled = false;
          const code = err?.code;
          if (code === "auth/invalid-action-code" || code === "auth/expired-action-code") {
            settled = true; // lõi đã tự bỏ link
            close();
            toast(t("acc.err.linkExpired"), "bad", 4500);
            openEmailSignInSheet();
          } else if (code === "auth/invalid-email") {
            errEl.textContent = t("acc.err.emailMismatch");
            input.focus();
          } else {
            errEl.textContent = mapAuthError(code) || t("acc.err.generic");
          }
        }
      },
    },
    h("h2", t("acc.confirmEmailTitle")),
    h("label.acc-label", { for: id }, t("acc.confirmEmailBody")),
    input,
    errEl,
    h("div.acc-btn-stack", confirmBtn, cancelBtn),
  );
  close = sheet(form, {
    onClose: () => {
      if (!settled) {
        settled = true;
        A.SY.cancelEmailLink();
      }
      onDismiss?.();
    },
  });
  setTimeout(() => input.focus({ preventScroll: true }), 40);
  return close;
}

/** Hộp chọn khi Đăng xuất (§3.2 — không dùng confirm()). */
export function openSignOutSheet(onAfter) {
  let close;
  const st = getSyncStatus();
  const pendingOffline = Boolean(st?.pending) && (st.state === "offline" || navigator.onLine === false);
  const keepBtn = h("button.btn.primary.wide", {
    type: "button",
    onclick: async () => {
      keepBtn.disabled = true;
      eraseBtn.disabled = true;
      try {
        await A.SY.signOut({ keepLocal: true });
        toast(t("acc.signedOut"));
        close();
        onAfter?.();
      } catch (e) {
        toast(mapAuthError(e?.code) || t("acc.err.generic"), "bad");
        keepBtn.disabled = false;
        eraseBtn.disabled = false;
      }
    },
  }, t("acc.signOutKeep"));
  const eraseBtn = h("button.btn.danger.wide", {
    type: "button",
    onclick: async () => {
      keepBtn.disabled = true;
      eraseBtn.disabled = true;
      try {
        await A.SY.signOut({ keepLocal: false });
        A.resetUiPrefs();
        applyLang();
        // Reset theme back to default
        delete document.documentElement.dataset.theme;
        toast(t("acc.signedOut"));
        close();
        go("#/welcome");
      } catch (e) {
        toast(mapAuthError(e?.code) || t("acc.err.generic"), "bad");
        keepBtn.disabled = false;
        eraseBtn.disabled = false;
      }
    },
  }, t("acc.signOutErase"));
  const body = h(
    "div.acc-dialog",
    h("h2", t("acc.signOut")),
    pendingOffline ? h("p.notice", `⚠ ${t("acc.signOutPending")}`) : null,
    h("div.acc-btn-stack", keepBtn, eraseBtn, h("p.muted.small", t("acc.signOutEraseNote")), h("button.btn.ghost.wide", { type: "button", onclick: () => close() }, t("acc.cancel"))),
  );
  close = sheet(body);
  return close;
}

/** Hộp xác nhận 2 bước để Xóa dữ liệu đám mây (§3.3). */
export function openDeleteCloudSheet({ startStep = 1, onAfter } = {}) {
  let close;
  const host = h("div.acc-dialog");

  function showStep1() {
    swapStep(
      host,
      h("h2", t("acc.delete")),
      h("p", t("acc.deleteStep1")),
      h(
        "div.acc-btn-stack",
        h("button.btn.danger.wide", { type: "button", onclick: showStep2 }, t("c.continue")),
        h("button.btn.wide", { type: "button", onclick: () => close() }, t("acc.cancel")),
      ),
    );
  }

  function showStep2() {
    const word = t("acc.deleteWord");
    const id = fieldId();
    const input = h("input.search", {
      id,
      type: "text",
      autocomplete: "off",
      autocapitalize: "characters",
      spellcheck: "false",
    });
    const errEl = h("p.acc-msg.small.err", { role: "status", "aria-live": "polite" });
    const delBtn = h("button.btn.danger.wide", { type: "submit", disabled: true }, t("acc.deleteForever"));
    input.addEventListener("input", () => {
      delBtn.disabled = normWord(input.value) !== normWord(word);
    });
    const form = h(
      "form.acc-form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          if (delBtn.disabled) return;
          delBtn.disabled = true;
          input.disabled = true;
          delBtn.textContent = t("acc.deleting");
          errEl.textContent = "";
          try {
            const res = await A.SY.deleteCloudData({ deleteAccount: true });
            close();
            if (res?.accountDeleted) toast(t("acc.deleteDone"), "good", 4000);
            else toast(t("acc.deletePartial"), "info", 6000);
            onAfter?.();
          } catch {
            delBtn.disabled = false;
            input.disabled = false;
            delBtn.textContent = t("acc.deleteForever");
            errEl.textContent = t("acc.deleteFail");
          }
        },
      },
      h("h2", t("acc.delete")),
      h("label.acc-label", { for: id }, t("acc.deleteType", { word })),
      input,
      errEl,
      h("div.acc-btn-stack", delBtn, h("button.btn.wide", { type: "button", onclick: () => close() }, t("acc.cancel"))),
    );
    swapStep(host, form);
    setTimeout(() => input.focus({ preventScroll: true }), 40);
  }

  if (startStep === 2) showStep2();
  else showStep1();

  close = sheet(host);
  return close;
}

/**
 * Thẻ Tài khoản dùng chung cho Hồ sơ (mode="me") và Cài đặt (mode="settings").
 * Trả về null nếu sync chưa bật (SY.isEnabled() === false).
 */
export function accountCard({ mode = "me", onRefresh } = {}) {
  if (!isSyncEnabled()) return null;
  const wrap = h(`section.card.acc-card${mode === "settings" ? ".settings" : ""}`, { id: mode === "settings" ? "account" : null });

  let tick = null;
  let unsub = null;

  const stop = () => {
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    if (unsub) {
      unsub();
      unsub = null;
    }
  };

  // KCS lần 6 M3: dựng khung một lần theo người dùng; trạng thái đổi chỉ cập nhật tại chỗ (giữ tiêu điểm, dòng lỗi, vùng aria-live).
  let builtFor; // undefined = chưa dựng; "" = chưa đăng nhập
  let statusEl = null;
  let syncBtn = null;
  let syncIco = null;

  const startTick = () => {
    if (tick) return;
    // Cập nhật thời gian tương đối mỗi phút khi màn đang mở (§5); chỉ chạy khi đã đăng nhập
    tick = setInterval(() => {
      if (!wrap.isConnected) return stop();
      const s = getSyncStatus();
      if (s?.state === "idle" && !s.pending) update(s);
    }, 60000);
  };

  function build(user) {
    const hadFocus = wrap.contains(document.activeElement);
    clear(wrap);
    statusEl = syncBtn = syncIco = null;
    if (!user) {
      if (tick) {
        clearInterval(tick);
        tick = null;
      }
      add(wrap, h("h2", mode === "settings" ? t("acc.section") : t("acc.title")), signedOutBlock());
    } else {
      syncIco = h("span", { "aria-hidden": "true" }, "↻");
      // Khóa bằng aria-disabled (không dùng disabled) để nút đang giữ tiêu điểm không bị rơi tiêu điểm lúc khóa
      syncBtn = h("button.icon-btn.acc-sync-btn", {
        type: "button",
        "aria-label": t("acc.syncNow"),
        title: t("acc.syncNow"),
        onclick: () => syncBtn.getAttribute("aria-disabled") !== "true" && A.SY.syncNow(),
      }, syncIco);
      statusEl = renderSyncStatus({ state: "idle", lastSyncAt: 0 });
      add(
        wrap,
        mode === "settings" ? h("h2", t("acc.section")) : null,
        h("div.acc-user-row", userAvatar(user, 48), h("div.acc-user-info", h("b.acc-name", displayNameOf(user)), user.email ? h("div.acc-email.muted.small", user.email) : null), syncBtn),
        statusEl,
      );
      if (mode === "me") {
        add(wrap, h("div.acc-foot", h("a.link.small", { href: "#/settings/account" }, t("acc.manage"))));
      } else {
        add(
          wrap,
          h(
            "div.settings-actions",
            h("button.btn", { type: "button", onclick: () => openSignOutSheet(() => onRefresh?.()) }, t("acc.signOut")),
            h("button.btn.danger", { type: "button", onclick: () => openDeleteCloudSheet({ onAfter: () => onRefresh?.() }) }, t("acc.delete")),
          ),
          h("div.acc-foot", h("a.link.small", { href: "#/privacy" }, t("acc.privacy"))),
        );
      }
      startTick();
    }
    // Thẻ đổi khung lúc đang giữ tiêu điểm (vừa đăng nhập / đăng xuất): đưa tiêu điểm về nút đầu của thẻ
    if (hadFocus) wrap.querySelector("button, a[href]")?.focus({ preventScroll: true });
  }

  function update(status) {
    if (!statusEl) return;
    const busy = status.state === "syncing";
    if (busy) syncBtn.setAttribute("aria-disabled", "true");
    else syncBtn.removeAttribute("aria-disabled");
    syncIco.className = busy ? "acc-spin" : "";
    if (updateSyncStatus(statusEl, status)) syncBtn.focus({ preventScroll: true });
  }

  function paint(st) {
    if (!wrap.isConnected && unsub) {
      stop();
      return;
    }
    const status = st || getSyncStatus();
    const user = status?.user || getCurrentUser();
    const key = user ? `u:${[user.uid, user.email, user.displayName, user.photoURL].join("|")}` : "";
    if (key !== builtFor) {
      build(user);
      builtFor = key;
    }
    if (user) update(status);
  }

  paint(getSyncStatus());

  if (!window.__ACC_MOCK__) {
    unsub = A.SY.onStatus((s) => paint(s));
  }
  window.addEventListener("hashchange", stop, { once: true });

  return wrap;
}
