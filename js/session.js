/* js/session.js — 악보 교체의 유일한 통로.
 * 열기·끌어다 놓기·앱 파일 실행·새 악보·데모·클라우드·사본이 모두 replaceScore를 거친다.
 * 변경이 있는 악보를 묻지도 않고 갈아 끼우지 않고, 연속 요청은 순서대로 처리한다. */
"use strict";
(function (SF) {
  const C = SF.core;
  let chain = Promise.resolve();

  /** 현재 악보를 보관해 둔 뒤라면 true. 2-B에서 IndexedDB 보관으로 교체된다(지금은 항상 실패 → 3지선다). */
  async function flushActive() { return false; }

  /** 현재 악보를 갈아 끼워도 되는지 확인한다. 읽기 전용이거나 변경이 없으면 묻지 않는다. */
  async function guard(reason = "다른 악보 열기") {
    if (C.state.readOnly || !C.state.dirty) return true;
    if (await flushActive()) return true;
    const choice = await SF.ui.choiceDialog({
      title: "저장하지 않은 변경 사항",
      message: `${reason} 전에 현재 악보를 어떻게 할까요?`,
      choices: [
        { id: "save", label: "파일로 저장하고 계속", primary: true },
        { id: "discard", label: "저장하지 않고 계속", danger: true },
        { id: "cancel", label: "취소" },
      ],
    });
    if (choice === "save") {
      try { SF.io.saveJSON(C.state.score); return true; } catch { return false; }
    }
    return choice === "discard";
  }

  /** 모든 교체 경로가 부른다. 교체했으면 true, 취소하거나 더 새로운 요청에 밀렸으면 false.
   * opts: reason(묻는 문구), confirmed(이미 확인함), stale(확인 뒤에도 유효한지), 나머지는 SF.app.installScore로 전달 */
  function replaceScore(next, opts = {}) {
    const run = async () => {
      if (!opts.confirmed && !(await guard(opts.reason))) return false;
      if (opts.stale?.()) return false;
      SF.app.installScore(next, opts);
      return true;
    };
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  }

  SF.session = { replaceScore, guard, flushActive };
})(window.SF);
