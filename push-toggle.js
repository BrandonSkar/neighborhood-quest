// The "🔔 Alerts on this phone" switch, shared by setup.html and setup-prize.html.
//
// Alerts are per-DEVICE on purpose: a phone only gets them if someone turned them on
// there, behind the setup code. That's how the grown-up's phone hears about every scan
// while every child's phone stays quiet. The state lives in the browser's own
// push subscription — there's nothing to remember and nothing to get out of step.
//
// Needs: a service worker on this origin (registered here if the game hasn't been opened
// on this phone yet) and a VAPID keypair on the server (see api/_lib/push.js).
(function () {
  // base64url public key -> the bytes pushManager.subscribe wants.
  // Whitespace is stripped first: a key pasted into a hosting dashboard often arrives
  // with a stray newline or a wrap, and atob() throws on those with a error message
  // that tells you nothing about what actually went wrong.
  function b64ToBytes(s) {
    const clean = (s || "").replace(/\s+/g, "");
    const pad = "=".repeat((4 - (clean.length % 4)) % 4);
    let raw;
    try { raw = atob((clean + pad).replace(/-/g, "+").replace(/_/g, "/")); }
    catch { throw new Error("VAPID_PUBLIC_KEY isn't valid base64 — re-copy it into Vercel (no spaces or line breaks)"); }
    const bytes = Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
    // an uncompressed P-256 point: 0x04 + 32 bytes X + 32 bytes Y
    if (bytes.length !== 65) throw new Error(`VAPID_PUBLIC_KEY is ${bytes.length} bytes, not 65 — it looks like the wrong key was pasted (the public one is the long 87-character string)`);
    return bytes;
  }
  // Register the worker as the page loads, not only when the switch is tapped: Chrome
  // wants a service worker before it will offer "Install app" instead of a bare
  // shortcut, and an installed app is what iPhone requires before it allows alerts.
  try {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
    }
  } catch { /* an un-installable page still works, it just can't buzz on iPhone */ }

  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = () => {
    try { return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; }
    catch { return false; }
  };

  // opts: { btn, status, hint, code }  — code is a FUNCTION returning the setup code,
  // because the page only learns it once the lock gate opens.
  window.initPushToggle = async function initPushToggle(opts) {
    const btn = document.getElementById(opts.btn);
    const status = document.getElementById(opts.status);
    const hint = document.getElementById(opts.hint);
    if (!btn) return;
    const say = (t) => { if (status) status.innerHTML = t; };
    const tip = (t) => { if (hint) hint.textContent = t || ""; };

    const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!canPush || !window.isSecureContext) {
      btn.disabled = true;
      btn.textContent = "🔕 This phone can't show alerts";
      tip(isIOS() && !standalone()
        ? "On iPhone, alerts only work once this page is added to the Home Screen (Share → Add to Home Screen, iOS 16.4+). Open it from there and try again."
        : "Alerts need https — open this page on the live site, not from a file.");
      return;
    }

    let reg;
    try {
      // the game registers this already, but setup may be the first page this phone opens
      await navigator.serviceWorker.register("sw.js").catch(() => {});
      reg = await navigator.serviceWorker.ready;
    } catch {
      btn.disabled = true; btn.textContent = "🔕 Alerts unavailable here";
      return;
    }

    let info = null;
    try {
      const r = await fetch("/api/push?code=" + encodeURIComponent(opts.code()), { cache: "no-store" });
      if (r.ok) info = await r.json();
    } catch { /* offline */ }
    if (!info || !info.configured || !info.publicKey) {
      btn.disabled = true;
      btn.textContent = "🔕 Alerts need a one-time setup";
      say('<b style="color:#d98a2e">not set up yet</b> — add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel (see below), then redeploy.');
      return;
    }

    const paint = (sub, phones) => {
      btn.disabled = false;
      btn.textContent = sub ? "🔔 Alerts ON for this phone — tap to turn off"
                            : "🔕 Alerts OFF on this phone — tap to turn on";
      const n = typeof phones === "number" ? phones : info.phones;
      say('<b style="color:#2eaf6f">ready ✓</b>' +
        (typeof n === "number" ? ` — ${n} phone${n === 1 ? "" : "s"} getting alerts` : ""));
    };
    paint(await reg.pushManager.getSubscription());

    btn.onclick = async () => {
      // Ask for permission FIRST, before anything is awaited. Safari (and iOS in
      // particular) only honours Notification.requestPermission() while the tap is still
      // "live" — put an await in front of it and the prompt silently never appears,
      // which looks exactly like a button that does nothing.
      let perm = (window.Notification && Notification.permission) || "denied";
      const already = perm === "granted";
      let ask = null;
      if (!already) { try { ask = Notification.requestPermission(); } catch (e) { ask = Promise.reject(e); } }

      btn.disabled = true;
      btn.textContent = "⏳ Asking your phone…";
      try {
        let sub = await reg.pushManager.getSubscription();
        if (sub) {                                   // already on -> turn it off
          const r = await fetch("/api/push", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: opts.code(), action: "unsubscribe", endpoint: sub.endpoint }),
          });
          const j = await r.json().catch(() => ({}));
          await sub.unsubscribe();
          tip("This phone won't get alerts any more.");
          paint(null, j.phones);
          return;
        }

        if (!already) perm = await ask;
        if (perm !== "granted") {
          tip(perm === "denied"
            ? "This phone is set to block notifications from this site. Turn them back on in Settings → Notifications (or the padlock in the address bar), then tap again."
            : "The phone didn't answer the permission question." +
              (isIOS() && !standalone() ? " On iPhone this only works from the app added to your Home Screen — open it from there and try again." : " Try tapping once more."));
          paint(null);
          return;
        }

        try {
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(info.publicKey) });
        } catch (e) {
          // a subscription left over from a different key can't be reused — clear it out
          if (e && e.name === "InvalidStateError") {
            const old = await reg.pushManager.getSubscription();
            if (old) await old.unsubscribe().catch(() => {});
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(info.publicKey) });
          } else throw e;
        }

        const r = await fetch("/api/push", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: opts.code(), action: "subscribe", sub: sub.toJSON() }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) { tip(j.error || "The server wouldn't save this phone — try again."); await sub.unsubscribe().catch(() => {}); paint(null); return; }
        tip("This phone gets alerts now. Do the same on any other phone that should hear about it.");
        paint(sub, j.phones);
      } catch (e) {
        // Say what actually broke. "Something went wrong" on a phone with no console is
        // the difference between a two-minute fix and giving up on the feature.
        const name = (e && e.name) || "Error";
        const msg = (e && e.message) || String(e);
        tip(name === "NotAllowedError"
          ? "The phone refused the subscription — check notifications are allowed for this site, then tap again."
          : name === "AbortError"
            ? "Your phone couldn't reach its notification service (this is common on a weak or filtered network). Try again on wifi."
            : `Didn't work — ${name}: ${msg}`);
        paint(await reg.pushManager.getSubscription().catch(() => null));
      }
    };
  };
})();
