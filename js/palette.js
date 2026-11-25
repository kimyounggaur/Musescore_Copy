/* Palette definitions preserve stable IDs for app commands and translations. */
"use strict";
(function (SF) {
  const PALETTE = [
  {
    "id": "input",
    "label": "입력",
    "items": [
      {
        "id": "btn-input",
        "label": "음표 입력 모드 켜기/끄기 (N)",
        "markup": "<button id=\"btn-input\" class=\"tbtn\" title=\"음표 입력 모드 켜기/끄기 (N)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><path d=\"m4 20 .8-3.2L16.6 5a1.8 1.8 0 0 1 2.6 0l.8.8a1.8 1.8 0 0 1 0 2.6L8.2 19.2 4 20Z\"/><path d=\"m14.5 7 2.5 2.5\"/></svg>\n    <span>입력 모드</span> <kbd>N</kbd>\n  </button>"
      },
      {
        "id": "btn-speedy",
        "label": "스피디 입력 — 숫자 키 한 번으로 음표 입력 (Q)",
        "markup": "<button id=\"btn-speedy\" class=\"tbtn\" title=\"스피디 입력 — 숫자 키 한 번으로 음표 입력 (Q)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M13.2 2 4.8 13.2h6.1L9.7 22l9.5-12.8h-6.4L13.2 2Z\"/></svg>\n    <span>스피디</span> <kbd>Q</kbd>\n  </button>"
      },
      {
        "id": "voice-buttons",
        "label": "성부 선택",
        "markup": "<span id=\"voice-buttons\" class=\"voice-buttons\" role=\"group\" aria-label=\"성부 선택\">\n    <button class=\"tbtn voice-btn\" data-voice=\"1\" title=\"성부 1 (Alt+1)\">성부 1</button>\n    <button class=\"tbtn voice-btn\" data-voice=\"2\" title=\"성부 2 (Alt+2)\">성부 2</button>\n    <button class=\"tbtn voice-btn\" data-voice=\"3\" title=\"성부 3 (Alt+3)\">성부 3</button>\n    <button class=\"tbtn voice-btn\" data-voice=\"4\" title=\"성부 4 (Alt+4)\">성부 4</button>\n  </span>"
      },
      {
        "id": "btn-delete",
        "label": "삭제 — 쉼표로 바꾸기 (Delete)",
        "markup": "<button id=\"btn-delete\" class=\"tbtn\" title=\"삭제 — 쉼표로 바꾸기 (Delete)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><path d=\"M5 7h14M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7M7 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h5.2a1.6 1.6 0 0 0 1.6-1.5L17 7\"/><path d=\"M10.2 11v5.5M13.8 11v5.5\"/></svg>\n    <span class=\"lbl\">삭제</span>\n  </button>"
      }
    ]
  },
  {
    "id": "duration",
    "label": "음길이",
    "items": [
      {
        "id": "dur-buttons",
        "label": "음길이",
        "markup": "<span id=\"dur-buttons\" role=\"group\" aria-label=\"음길이\"></span>"
      },
      {
        "id": "btn-dot",
        "label": "점음표 (.)",
        "markup": "<button id=\"btn-dot\" class=\"tbtn\" title=\"점음표 (.)\" style=\"font-weight:900;font-size:18px\">·</button>"
      },
      {
        "id": "btn-rest",
        "label": "쉼표 입력 (0)",
        "markup": "<button id=\"btn-rest\" class=\"tbtn\" title=\"쉼표 입력 (0)\"></button>"
      }
    ]
  },
  {
    "id": "accidental",
    "label": "임시표·타이",
    "items": [
      {
        "id": "btn-sharp",
        "label": "올림표 ♯",
        "markup": "<button id=\"btn-sharp\" class=\"tbtn\" title=\"올림표 ♯\"></button>"
      },
      {
        "id": "btn-flat",
        "label": "내림표 ♭",
        "markup": "<button id=\"btn-flat\" class=\"tbtn\" title=\"내림표 ♭\"></button>"
      },
      {
        "id": "btn-natural",
        "label": "제자리표 ♮",
        "markup": "<button id=\"btn-natural\" class=\"tbtn\" title=\"제자리표 ♮\"></button>"
      },
      {
        "id": "btn-tie",
        "label": "붙임줄(타이) — 같은 음 연결 (T)",
        "markup": "<button id=\"btn-tie\" class=\"tbtn\" title=\"붙임줄(타이) — 같은 음 연결 (T)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><circle cx=\"4.5\" cy=\"10\" r=\"2\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"19.5\" cy=\"10\" r=\"2\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M5.5 13.5q6.5 6 13 0\"/></svg>\n    <span class=\"lbl\">타이</span>\n  </button>"
      },
      {
        "id": "btn-grace",
        "label": "꾸밈음 추가 (/)",
        "markup": "<button id=\"btn-grace\" class=\"tbtn\" title=\"꾸밈음 추가 (/)\">𝆔</button>"
      },
      {
        "id": "btn-slur",
        "label": "이음줄(슬러) — 부드럽게 잇기 (S, 범위 선택 후)",
        "markup": "<button id=\"btn-slur\" class=\"tbtn\" title=\"이음줄(슬러) — 부드럽게 잇기 (S, 범위 선택 후)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><circle cx=\"4.5\" cy=\"15\" r=\"2\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"19.5\" cy=\"15\" r=\"2\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M5 11.5q7-7.5 14 0\"/></svg>\n    <span class=\"lbl\">이음줄</span>\n  </button>"
      }
    ]
  },
  {
    "id": "symbols",
    "label": "기호",
    "items": [
      {
        "id": "btn-gliss",
        "label": "글리산도",
        "markup": "<button id=\"btn-gliss\" class=\"tbtn\" title=\"글리산도\">글리산도</button>"
      },
      {
        "id": "btn-arpeggio",
        "label": "아르페지오",
        "markup": "<button id=\"btn-arpeggio\" class=\"tbtn\" title=\"아르페지오\">아르페지오</button>"
      },
      {
        "id": "btn-tremolo",
        "label": "트레몰로",
        "markup": "<button id=\"btn-tremolo\" class=\"tbtn\" title=\"트레몰로\">트레몰로</button>"
      },
      {
        "label": "스타카토 — 짧게 끊어서 (Shift+S)",
        "markup": "<button class=\"tbtn artic-btn\" data-artic=\"staccato\" title=\"스타카토 — 짧게 끊어서 (Shift+S)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\"><ellipse cx=\"10\" cy=\"9\" rx=\"4.4\" ry=\"3.2\" fill=\"currentColor\" transform=\"rotate(-21 10 9)\"/><line x1=\"13.9\" y1=\"8\" x2=\"13.9\" y2=\"-2\" stroke=\"currentColor\" stroke-width=\"1.6\"/><circle cx=\"10\" cy=\"17.5\" r=\"2\" fill=\"currentColor\"/></svg>\n  </button>"
      },
      {
        "label": "테누토 — 음길이를 충분히 (Shift+N)",
        "markup": "<button class=\"tbtn artic-btn\" data-artic=\"tenuto\" title=\"테누토 — 음길이를 충분히 (Shift+N)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\"><ellipse cx=\"10\" cy=\"9\" rx=\"4.4\" ry=\"3.2\" fill=\"currentColor\" transform=\"rotate(-21 10 9)\"/><rect x=\"5.5\" y=\"16.5\" width=\"9\" height=\"2\" rx=\"1\" fill=\"currentColor\"/></svg>\n  </button>"
      },
      {
        "label": "악센트 — 세게 강조 (Shift+V)",
        "markup": "<button class=\"tbtn artic-btn\" data-artic=\"accent\" title=\"악센트 — 세게 강조 (Shift+V)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M5 7 L17 12 L5 17\"/></svg>\n  </button>"
      },
      {
        "label": "마르카토 — 매우 강하게 (Shift+O)",
        "markup": "<button class=\"tbtn artic-btn\" data-artic=\"marcato\" title=\"마르카토 — 매우 강하게 (Shift+O)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 16 L12 6 L18 16\"/></svg>\n  </button>"
      },
      {
        "label": "페르마타 — 충분히 늘이기",
        "markup": "<button class=\"tbtn artic-btn\" data-artic=\"fermata\" title=\"페르마타 — 충분히 늘이기\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><path d=\"M4 15 A 8.2 8.2 0 0 1 20 15\"/><circle cx=\"12\" cy=\"13.5\" r=\"1.7\" fill=\"currentColor\" stroke=\"none\"/></svg>\n  </button>"
      },
      {
        "id": "btn-trill",
        "label": "트릴",
        "markup": "<button id=\"btn-trill\" class=\"tbtn\" title=\"트릴\">tr</button>"
      },
      {
        "id": "btn-mordent",
        "label": "모르덴트",
        "markup": "<button id=\"btn-mordent\" class=\"tbtn\" title=\"모르덴트\">모르덴트</button>"
      },
      {
        "id": "btn-turn",
        "label": "턴",
        "markup": "<button id=\"btn-turn\" class=\"tbtn\" title=\"턴\">턴</button>"
      },
      {
        "id": "btn-ottava-up",
        "label": "8va 옥타브 선",
        "markup": "<button id=\"btn-ottava-up\" class=\"tbtn\" title=\"8va 옥타브 선\">8va</button>"
      },
      {
        "id": "btn-ottava-down",
        "label": "8vb 옥타브 선",
        "markup": "<button id=\"btn-ottava-down\" class=\"tbtn\" title=\"8vb 옥타브 선\">8vb</button>"
      }
    ]
  },
  {
    "id": "text",
    "label": "텍스트",
    "items": [
      {
        "id": "btn-lyric",
        "label": "가사 입력 (L 또는 음표 더블클릭)",
        "markup": "<button id=\"btn-lyric\" class=\"tbtn\" title=\"가사 입력 (L 또는 음표 더블클릭)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><path d=\"M4 5h16M4 10h16M4 15h9\"/><path d=\"m16.5 19.5 1.2-3.6 3.6-1.2-2.4 4.8-2.4 0Z\" fill=\"currentColor\"/></svg>\n    <span class=\"lbl\">가사</span>\n  </button>"
      },
      {
        "id": "btn-chord-symbol",
        "label": "코드 기호 입력 (Ctrl+K)",
        "markup": "<button id=\"btn-chord-symbol\" class=\"tbtn\" title=\"코드 기호 입력 (Ctrl+K)\">코드</button>"
      },
      {
        "id": "btn-tempo-mark",
        "label": "선택 위치에 템포 표시 (Shift+T)",
        "markup": "<button id=\"btn-tempo-mark\" class=\"tbtn\" title=\"선택 위치에 템포 표시 (Shift+T)\">♩=</button>"
      },
      {
        "id": "btn-rehearsal",
        "label": "리허설 마크 (R)",
        "markup": "<button id=\"btn-rehearsal\" class=\"tbtn\" title=\"리허설 마크 (R)\">리허설</button>"
      },
      {
        "id": "btn-staff-text",
        "label": "스태프 텍스트 (Shift+L)",
        "markup": "<button id=\"btn-staff-text\" class=\"tbtn\" title=\"스태프 텍스트 (Shift+L)\">스태프 텍스트</button>"
      },
      {
        "id": "lyric-verse",
        "label": "가사 절",
        "markup": "<select id=\"lyric-verse\" class=\"tsel compact\" title=\"가사 절\">\n    <option value=\"1\">1절</option>\n    <option value=\"2\">2절</option>\n    <option value=\"3\">3절</option>\n    <option value=\"4\">4절</option>\n  </select>"
      }
    ]
  },
  {
    "id": "measure",
    "label": "반복·마디",
    "items": [
      {
        "id": "btn-repeat-start",
        "label": "시작 반복 마디선",
        "markup": "<button id=\"btn-repeat-start\" class=\"tbtn\" title=\"시작 반복 마디선\">|:</button>"
      },
      {
        "id": "btn-repeat-end",
        "label": "끝 반복 마디선",
        "markup": "<button id=\"btn-repeat-end\" class=\"tbtn\" title=\"끝 반복 마디선\">:|</button>"
      },
      {
        "id": "btn-repeat-count",
        "label": "반복 횟수 설정",
        "markup": "<button id=\"btn-repeat-count\" class=\"tbtn\" title=\"반복 횟수 설정\">×2</button>"
      },
      {
        "id": "btn-volta-1",
        "label": "1번 엔딩(볼타)",
        "markup": "<button id=\"btn-volta-1\" class=\"tbtn\" title=\"1번 엔딩(볼타)\">1.</button>"
      },
      {
        "id": "btn-volta-2",
        "label": "2번 엔딩(볼타)",
        "markup": "<button id=\"btn-volta-2\" class=\"tbtn\" title=\"2번 엔딩(볼타)\">2.</button>"
      },
      {
        "id": "btn-break-system",
        "label": "선택 마디 뒤 시스템 줄바꿈",
        "markup": "<button id=\"btn-break-system\" class=\"tbtn\" title=\"선택 마디 뒤 시스템 줄바꿈\">↵</button>"
      },
      {
        "id": "btn-break-page",
        "label": "선택 마디 뒤 페이지 나눔",
        "markup": "<button id=\"btn-break-page\" class=\"tbtn\" title=\"선택 마디 뒤 페이지 나눔\">쪽나눔</button>"
      },
      {
        "id": "btn-break-section",
        "label": "선택 마디 뒤 섹션 브레이크",
        "markup": "<button id=\"btn-break-section\" class=\"tbtn\" title=\"선택 마디 뒤 섹션 브레이크\">구역나눔</button>"
      },
      {
        "id": "btn-measure-insert",
        "label": "앞에 마디 삽입",
        "markup": "<button id=\"btn-measure-insert\" class=\"tbtn\" title=\"앞에 마디 삽입\">＋마디</button>"
      },
      {
        "id": "btn-measure-delete",
        "label": "선택 마디 삭제",
        "markup": "<button id=\"btn-measure-delete\" class=\"tbtn\" title=\"선택 마디 삭제\">−마디</button>"
      },
      {
        "id": "btn-measure-options",
        "label": "마디 조표·박자·음자리표",
        "markup": "<button id=\"btn-measure-options\" class=\"tbtn\" title=\"마디 조표·박자·음자리표\">마디 설정</button>"
      }
    ]
  },
  {
    "id": "dynamic",
    "label": "셈여림",
    "items": [
      {
        "label": "피아니시모 — 매우 여리게",
        "markup": "<button class=\"tbtn dynbtn\" data-dyn=\"pp\" title=\"피아니시모 — 매우 여리게\">pp</button>"
      },
      {
        "label": "피아노 — 여리게",
        "markup": "<button class=\"tbtn dynbtn\" data-dyn=\"p\" title=\"피아노 — 여리게\">p</button>"
      },
      {
        "label": "메조피아노 — 조금 여리게",
        "markup": "<button class=\"tbtn dynbtn\" data-dyn=\"mp\" title=\"메조피아노 — 조금 여리게\">mp</button>"
      },
      {
        "label": "메조포르테 — 조금 세게",
        "markup": "<button class=\"tbtn dynbtn\" data-dyn=\"mf\" title=\"메조포르테 — 조금 세게\">mf</button>"
      },
      {
        "label": "포르테 — 세게",
        "markup": "<button class=\"tbtn dynbtn\" data-dyn=\"f\" title=\"포르테 — 세게\">f</button>"
      },
      {
        "label": "포르티시모 — 매우 세게",
        "markup": "<button class=\"tbtn dynbtn\" data-dyn=\"ff\" title=\"포르티시모 — 매우 세게\">ff</button>"
      },
      {
        "id": "btn-cresc",
        "label": "크레셴도 — 점점 세게 (범위 선택 후 <)",
        "markup": "<button id=\"btn-cresc\" class=\"tbtn\" title=\"크레셴도 — 점점 세게 (범위 선택 후 <)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\"><path d=\"M20 6 L4 12 L20 18\"/></svg>\n  </button>"
      },
      {
        "id": "btn-dim",
        "label": "디미누엔도 — 점점 여리게 (범위 선택 후 >)",
        "markup": "<button id=\"btn-dim\" class=\"tbtn\" title=\"디미누엔도 — 점점 여리게 (범위 선택 후 >)\">\n    <svg class=\"ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\"><path d=\"M4 6 L20 12 L4 18\"/></svg>\n  </button>"
      }
    ]
  }
];
  function init() {
    const host = document.querySelector(".palette-bar"); host.replaceChildren();
    const tabs = document.createElement("div"); tabs.className="palette-tabs"; tabs.setAttribute("role","tablist"); tabs.setAttribute("aria-label","팔레트 그룹");
    const panels = document.createElement("div"); panels.className="palette-groups";
    PALETTE.forEach((group,i)=>{
      const tab=document.createElement("button");tab.id="palette-tab-"+group.id;tab.type="button";tab.className="palette-tab";tab.textContent=group.label;tab.setAttribute("role","tab");tab.setAttribute("aria-controls","palette-"+group.id);tab.setAttribute("aria-selected",String(i===0));tab.tabIndex=i===0?0:-1;
      const panel=document.createElement("div"); panel.id="palette-"+group.id;panel.className="palette-group"+(i===0?" active":"");panel.setAttribute("role","tabpanel");panel.setAttribute("aria-labelledby",tab.id);
      for(const item of group.items) { const t=document.createElement("template"); t.innerHTML=item.markup;panel.append(t.content); }
      tab.addEventListener("click",()=>{host.querySelectorAll(".palette-group").forEach(p=>p.classList.toggle("active",p===panel));host.querySelectorAll(".palette-tab").forEach(b=>{b.setAttribute("aria-selected",String(b===tab));b.tabIndex=b===tab?0:-1;});});
      tabs.append(tab);panels.append(panel);
    });
    host.append(tabs,panels);
    host.addEventListener("keydown",e=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key)||e.target.matches("input,select"))return;
      const group=e.target.closest(".palette-group")||tabs;
      const buttons=[...group.querySelectorAll("button:not([disabled])")].filter(b=>b.getClientRects().length);
      const i=buttons.indexOf(e.target);if(i<0)return;e.preventDefault();e.stopPropagation();
      const next=e.key==="Home"?0:e.key==="End"?buttons.length-1:(i+(e.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;
      buttons.forEach((b,j)=>b.tabIndex=j===next?0:-1);buttons[next].focus();
      if(buttons[next].getAttribute("role")==="tab")buttons[next].click();
    });
    refreshView();
    if(!listening){listening=true;document.addEventListener("sf:view-level",refreshView);}
  }
  function quickAccess() {
    const host=document.createElement("div");host.className="palette-quick";host.setAttribute("role","toolbar");host.setAttribute("aria-label","자주 쓰는 입력");
    for(const selector of ["#btn-input",'#dur-buttons [data-i="3"]','#dur-buttons [data-i="4"]',"#btn-rest","#btn-dot","#btn-tie","#btn-undo","#btn-delete"]) {
      const target=document.querySelector(selector),button=document.createElement("button");button.type="button";button.className="tbtn";button.title=target.title;button.setAttribute("aria-label",target.title);button.innerHTML=target.querySelector("svg")?.outerHTML||target.textContent;
      button.addEventListener("click",()=>target.click());host.append(button);
    }
    document.querySelector(".palette-bar").append(host);
    refreshView();
  }
  /* 보기 수준(P9-1)에 맞춰 모음마다 "탭으로 들어가는 단추"(보이는 첫 단추)를 다시 정하고, 단추가 모두 숨은 모음은 탭·본문째 숨긴다.
     숨은 첫 단추가 tabindex=0을 쥐고 있으면 그 모음에 키보드로 들어갈 길이 없어지기 때문이다. 쓰던 모음이 비면 보이는 첫 모음으로 옮긴다. */
  let listening=false;
  const viewHidden=el=>document.documentElement.dataset.view==="basic"&&!!el.closest('[data-tier="advanced"],[data-tier="rare"]');
  function refreshView() {
    const host=document.querySelector(".palette-bar");if(!host)return;
    let current=null,firstOpen=null;
    for(const panel of host.querySelectorAll(".palette-group")) {
      const buttons=[...panel.querySelectorAll("button")],shown=buttons.filter(b=>!viewHidden(b)),empty=shown.length===0;
      const tab=host.querySelector("#palette-tab-"+panel.id.slice("palette-".length));
      panel.hidden=empty;if(tab)tab.hidden=empty;
      buttons.forEach(b=>{b.tabIndex=-1;});
      if(!empty)shown[0].tabIndex=0;
      if(panel.classList.contains("active"))current={empty};
      if(!empty&&!firstOpen)firstOpen=tab;
    }
    if(current?.empty&&firstOpen)firstOpen.click();
  }
  SF.palette={PALETTE,init,quickAccess,refreshView};
})(window.SF);
