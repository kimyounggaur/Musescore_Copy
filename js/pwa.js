"use strict";
(function(SF) {
  let initialized = false;
  let registration;
  function message(key, fallback) { return SF.t ? SF.t(key) : fallback; }
  function networkStatus() {
    const status = document.getElementById("network-status");
    if (!status) return;
    status.textContent = navigator.onLine ? message("status.online", "온라인") : message("status.offline", "오프라인");
    status.dataset.online = String(navigator.onLine);
  }
  function updateReady(worker) {
    let button = document.getElementById("app-update");
    if (!button) {
      button = document.createElement("button");
      button.id = "app-update";
      button.className = "btn";
      button.textContent = message("pwa.update", "새 버전 · 새로고침");
      document.querySelector(".statusbar")?.appendChild(button);
    }
    button.onclick = async () => {
      if (SF.core.state.dirty) {
        const ok = await SF.ui.confirmDialog({ title: message("pwa.updateTitle", "새 버전 적용"), message: message("pwa.saveFirst", "현재 악보를 파일로 저장한 뒤 새 버전을 적용할까요?"), confirmText: message("pwa.saveReload", "저장 후 새로고침") });
        if (!ok) return;
        SF.io.saveJSON(SF.core.state.score);
      }
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
      worker.postMessage({ type: "ACTIVATE_UPDATE" });
    };
  }
  function handleFileLaunch() {
    if (!("launchQueue" in window)) return;
    window.launchQueue.setConsumer(async launch => {
      for (const handle of launch.files || []) {
        try {
          const file = await handle.getFile();
          SF.io.loadScoreFile(file, SF.app.handleLoadedScore);
        } catch (error) { SF.app.toast(error.message); }
      }
    });
  }
  async function init() {
    if (initialized) return;
    initialized = true;
    const status = document.createElement("span");
    status.id = "network-status"; status.setAttribute("role", "status");
    document.querySelector(".statusbar")?.appendChild(status);
    networkStatus();
    window.addEventListener("online", networkStatus);
    window.addEventListener("offline", networkStatus);
    window.addEventListener("scoreforge:language", networkStatus);
    handleFileLaunch();
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    try {
      registration = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
      if (registration.waiting) updateReady(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) updateReady(worker);
        });
      });
    } catch (error) { console.warn("Offline installation unavailable:", error.message); }
  }
  SF.pwa = { init, get registration() { return registration; } };
})(window.SF);
