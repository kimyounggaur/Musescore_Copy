/* ScoreForge accessible dialogs. Text is always inserted as text, never markup. */
"use strict";
(function (SF) {
  const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex="0"], a[href]';
  function focusTrap(dialog) {
    if (dialog.dataset.focusManaged) return;
    dialog.dataset.focusManaged = "true";
    const nativeShow = dialog.showModal;
    dialog.showModal = function () { dialog.__trigger = document.activeElement; return nativeShow.call(dialog); };
    const heading = dialog.querySelector("h2");
    if (heading) { heading.id ||= `${dialog.id}-title`; dialog.setAttribute("aria-labelledby", heading.id); }
    let trigger = null;
    const observer = new MutationObserver(() => {
      if (dialog.open) {
        trigger = dialog.__trigger || document.activeElement;
        queueMicrotask(() => (dialog.querySelector("[autofocus]") || dialog.querySelector(focusable))?.focus());
      }
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    dialog.addEventListener("close", () => { if (trigger?.isConnected && !dialog.contains(trigger)) trigger.focus(); });
    dialog.addEventListener("keydown", e => {
      if (e.key !== "Tab") return;
      const items = [...dialog.querySelectorAll(focusable)].filter(el => el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  function open(dialog) {
    dialog.__trigger = document.activeElement;
    focusTrap(dialog);
    if (!dialog.open) dialog.showModal();
  }
  function promptDialog(options = {}) {
    return new Promise(resolve => {
      const dialog = document.createElement("dialog");
      dialog.id = "dlg-prompt";
      dialog.className = "app-prompt";
      const form = document.createElement("form");
      form.className = "dlg-body";
      form.noValidate = true;
      const title = document.createElement("h2"); title.textContent = options.title || "입력";
      const message = document.createElement("p"); message.textContent = options.message || "";
      const label = document.createElement("label"); label.textContent = options.label || options.title || "내용";
      const input = document.createElement(options.multiline ? "textarea" : "input");
      input.id = "prompt-value"; input.value = String(options.value ?? ""); input.autofocus = true;
      if (!options.multiline) input.type = options.type || "text";
      for (const key of ["min", "max", "step", "maxLength", "placeholder"]) if (options[key] !== undefined) input[key] = options[key];
      label.htmlFor = input.id;
      const error = document.createElement("p"); error.id = "prompt-error"; error.className = "dialog-error"; error.setAttribute("role", "alert");
      input.setAttribute("aria-describedby", error.id);
      const actions = document.createElement("div"); actions.className = "dlg-actions";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "tbtn"; cancel.textContent = options.cancelText || "취소";
      const ok = document.createElement("button"); ok.type = "submit"; ok.className = `tbtn ${options.danger ? "danger" : "primary"}`; ok.textContent = options.confirmText || "확인";
      let value = null;
      actions.append(cancel, ok); form.append(title, message);
      if (!options.confirm) form.append(label, input);
      form.append(error, actions); dialog.append(form); document.body.append(dialog);
      cancel.addEventListener("click", () => dialog.close());
      form.addEventListener("submit", e => {
        e.preventDefault();
        const problem = options.validate?.(input.value);
        if (problem) { error.textContent = problem; input.setAttribute("aria-invalid", "true"); input.focus(); return; }
        value = options.confirm ? true : input.value; dialog.close();
      });
      dialog.addEventListener("close", () => { dialog.remove(); resolve(value); }, { once: true });
      open(dialog);
      if (!options.confirm) input.select?.(); else (options.danger ? cancel : ok).focus();
    });
  }
  const confirmDialog = options => promptDialog({ ...options, confirm: true }).then(Boolean);
  function init() {
    document.querySelectorAll("dialog").forEach(focusTrap);
    document.addEventListener("pointerdown", () => {
      document.querySelectorAll("dialog:not([open])").forEach(d => { d.__trigger = document.activeElement; });
    }, true);
    new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.matches("dialog")) focusTrap(n);
      n.querySelectorAll?.("dialog").forEach(focusTrap);
    }))).observe(document.body, { childList: true, subtree: true });
  }
  SF.ui = { ...(SF.ui || {}), promptDialog, confirmDialog, focusTrap, open, init };
})(window.SF);
