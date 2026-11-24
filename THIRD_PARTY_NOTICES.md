# 제3자 구성 요소 고지 (Third-party notices)

ScoreForge는 아래 글꼴·라이브러리·음원을 사용합니다. 각 구성 요소의 저작권은 해당 저작권자에게 있으며, 사용 조건은 표에 적은 라이선스를 따릅니다. 앱에서는 도움말 창의 "정보"에서 같은 내용을 볼 수 있습니다(이 문서에서 `licenses.html`을 자동으로 만듭니다).

- ScoreForge 자체 코드의 라이선스는 아직 정해지지 않았습니다. 저장소 소유자가 정할 일입니다(`docs/DECISIONS.md` D5).
- 이 문서는 법률 자문이 아닙니다. 조사한 날짜는 2026-11-25입니다. "출처 기재"는 그 구성 요소를 배포하는 쪽이 적어 둔 내용을 그대로 옮겼다는 뜻이고, 확인하지 못한 것은 아래 "확인 필요"에 남겼습니다.
- English summary: ScoreForge bundles the Bravura music font (SIL Open Font License 1.1) and the supabase-js and smplr libraries (MIT). Instrument samples are not bundled; your browser downloads them from third-party servers (see section 2). The licence of ScoreForge's own code has not been chosen yet.

## 1. 앱과 함께 배포하는 구성 요소 (Bundled components)

| 구성 요소 | 버전 | 쓰이는 곳 | 저작권자 | 라이선스 | 파일 | 라이선스 전문 |
|---|---|---|---|---|---|---|
| Bravura | 1.392 | 악보 기호(음표·쉼표·악상 기호 등) | Steinberg Media Technologies GmbH | SIL Open Font License 1.1 | `fonts/Bravura.woff2` | [fonts/OFL.txt](fonts/OFL.txt) |
| supabase-js | 2.114.0 | 로그인·클라우드 저장 | Supabase | MIT | `vendor/supabase.js` | [vendor/supabase-LICENSE](vendor/supabase-LICENSE) |
| smplr | 1.0.0 | 샘플 악기 재생 | danigb 외 smplr 기여자 | MIT | `vendor/smplr/index.mjs` | [vendor/smplr/LICENSE](vendor/smplr/LICENSE) |

- **Bravura**: 글꼴 파일 안에 저작권 문구와 SIL OFL 1.1 전문이 들어 있고, `fonts/OFL.txt`는 그 문구를 그대로 옮긴 것입니다(시험이 같은지 확인합니다). "Bravura"는 예약된 글꼴 이름이어서, 글꼴을 고쳐 배포하려면 이름을 바꿔야 합니다.
- **supabase-js**: 번들(`vendor/supabase.js`) 안에는 같은 버전(2.114.0)의 하위 패키지 auth-js·postgrest-js·realtime-js·storage-js·functions-js(모두 MIT)와 @supabase/phoenix 0.4.5(MIT), iceberg-js 0.8.1(MIT), tslib 2.8.1(0BSD)이 함께 들어 있습니다. 각 패키지의 `license` 필드로 확인했습니다.
- **smplr**: 원 저장소에는 별도 라이선스 파일이 없어, `package.json`의 MIT 선언을 기준으로 쓴 문구를 `vendor/smplr/LICENSE`에 두었습니다.
- 위 세 가지의 받은 곳 주소와 해시는 `vendor/manifest.json`에 있습니다.

## 2. 외부에서 불러오는 음원 (Instrument samples — ScoreForge가 배포하지 않음)

소리를 낼 때, 또는 앱을 쓰기 시작한 뒤 쉬는 시간에 그 악보의 악기를 미리, 브라우저가 아래 서버에서 샘플을 직접 내려받습니다(악보 설정의 ‘음원 미리 받기’에서 끌 수 있음). ScoreForge는 이 샘플 파일을 저장소나 배포본에 넣어 두지 않았습니다.

| 음원 | 쓰이는 곳 | 불러오는 서버 | 원본·제작 | 라이선스(출처 기재) | 재배포·자체 호스팅 |
|---|---|---|---|---|---|
| Soundfont — MusyngKite 키트 | 기본 소리: 피아노·일렉피아노·뮤직박스·오르간·스트링·플루트·클래식 기타·8비트 | gleitz.github.io | Musyng Kite(제작자 Sarcyan)를 gleitz/midi-js-soundfonts가 웹용으로 변환 | CC BY-SA 3.0(gleitz 저장소 설명) | **불명 — 하지 않음.** 표기가 엇갈림(아래 설명) |
| Splendid Grand Piano | 설정에서 고르는 고음질 피아노 | smpldsnds.github.io | AKAI Steinway 샘플(sfzinstruments 목록), smpldsnds가 웹용으로 올림 | Public Domain(sfzinstruments 목록·smpldsnds 저장소 설명) | 가능(출처 기재 기준) |
| 반복 구간 데이터 | 쓰지 않음 | goldst.dev | — | — | 해당 없음. smplr의 선택 기능(`loadLoopData`)에서만 쓰는 주소이고 앱은 켜지 않아 요청하지 않음 |

- **Soundfont(MusyngKite)**: gleitz 저장소는 이 키트가 CC BY-SA 3.0이라고 적고 원본을 `Musyng Kite.sfpack`이라고 밝히지만 제작자 이름은 적지 않았습니다. 원본의 제작자는 Sarcyan이며, 제작자 공지에는 "여러 사람의 샘플과 본인 작업을 모은 것"이라는 설명이 있고, 한 목록에는 "개인 사용, 더 강한 제한 없이 재배포"로, 다른 목록에는 "비상업"으로 적혀 있어 조건이 서로 맞지 않습니다. 그래서 ScoreForge는 이 샘플을 자체 서버로 옮겨 다시 배포하지 않고, 이용자의 브라우저가 gleitz.github.io에서 직접 받도록 둡니다. 저작자 표시: "Musyng Kite — Sarcyan, CC BY-SA 3.0, via gleitz/midi-js-soundfonts".
- **Splendid Grand Piano**: sfzinstruments 목록에는 제작 AKAI, 라이선스 Public Domain으로 적혀 있습니다. 원 제작자의 직접 문서는 확인하지 못했습니다.
- 위 서버들은 이 앱의 운영자가 아닌 제3자가 운영합니다. 샘플을 받을 때 이용자의 접속 정보(IP 주소 등)가 그 서버에 남을 수 있습니다(`privacy.html` 4절).

## 3. 확인 필요 (Open items)

1. **ScoreForge 자체 코드의 라이선스**: 저장소에 `LICENSE`가 없습니다. 소유자가 정해야 합니다(`docs/DECISIONS.md` D5).
2. **Musyng Kite 원본의 실제 이용 조건과 샘플 출처**: 확인되기 전에는 자체 호스팅·재배포를 하지 않습니다.
3. **Splendid Grand Piano의 Public Domain 표기**: 목록 기재 기준입니다. 원 제작자의 직접 문서는 확인하지 못했습니다.
4. **supabase-js 번들 안 하위 패키지의 저작권 문구 원문**: 라이선스 종류(MIT·0BSD)만 확인했습니다. 필요하면 각 패키지의 LICENSE 전문을 보태야 합니다.
5. **그 밖의 파일**: 앱 아이콘(`icons/`)·사용 설명서(`manual/`)의 저작권자, 데모 악보(나비야·반짝반짝 작은 별·리듬 연습)의 편곡·가사 출처.

## 4. 조사에 쓴 출처 (Sources)

- Soundfont: [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) · [gleitz.github.io/midi-js-soundfonts](https://gleitz.github.io/midi-js-soundfonts)
- Musyng Kite: [제작자 공지(KVR)](https://www.kvraudio.com/forum/viewtopic.php?p=6381337) · [제작자 답변을 옮긴 포럼 글(OC ReMix)](https://ocremix.org/community/topic/40101-should-i-trust-royalty-free-soundfonts) · [Polyphone 목록](https://www.polyphone.io/en/soundfonts/instrument-sets/258-musyng-kite)
- Splendid Grand Piano: [sfzinstruments 피아노 목록](https://sfzinstruments.github.io/pianos) · [smpldsnds 저장소 목록](https://github.com/smpldsnds)
- supabase-js 하위 패키지: [supabase-js 2.114.0 package.json](https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.114.0/package.json)
