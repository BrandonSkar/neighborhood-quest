// The "🔔 Alerts on this phone" switch, shared by setup.html and setup-prize.html.
//
// Alerts are per-DEVICE on purpose: a phone only gets them if someone turned them on
// there, behind the setup code. That's how the grown-up's phone hears about a picked
// prize while every child's phone stays quiet. The state lives in the browser's own
// push subscription — there's nothing to remember and nothing to get out of step.
//
// Needs: a service worker on this origin (registered here if the game hasn't been opened
// on this phone yet) and a VAPID keypair on the server (see api/_lib/push.js).
(function () {
  // base64url public key -> the bytes pushManager.subscribe wants
  function b64ToBytes(s) {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }
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
      btn.disabled = true;
      try {
        let sub = await reg.pushManager.getSubscription();
        if (sub) {
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
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          tip("Notifications are blocked for this site — allow them in the phone's settings, then try again.");
          paint(null);
          return;
        }
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(info.publicKey) });
        const r = await fetch("/api/push", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: opts.code(), action: "subscribe", sub: sub.toJSON() }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) { tip(j.error || "The server wouldn't save this phone — try again."); await sub.unsubscribe().catch(() => {}); paint(null); return; }
        tip("This phone gets alerts now. Do the same on any other phone that should hear about it.");
        paint(sub, j.phones);
      } catch (e) {
        tip("Hmm, that didn't work — check the connection and try again.");
        paint(await reg.pushManager.getSubscription().catch(() => null));
      }
    };
  };
})();
