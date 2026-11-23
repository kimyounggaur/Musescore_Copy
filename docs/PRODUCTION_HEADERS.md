# 운영 보안 헤더 기록

- 확인 날짜: 2026-11-23
- 상태: **운영 값 미확인.** 클라우드 샌드박스에서 `musescore-copy.vercel.app`으로 나가는 요청이 프록시에 막혀(HTTP 403) 응답 헤더를 받지 못했다. 아래 표의 "운영 값"은 🧑 사람이 채운다.

## 확인 명령 (🧑)
```powershell
curl.exe -sI https://musescore-copy.vercel.app/
```
응답에서 아래 5개 헤더를 그대로 붙여 넣는다.

## 비교표
| 헤더 | vercel.json 값(016ad44) | 운영 값 | 비교 |
|---|---|---|---|
| content-security-policy | `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://unpkg.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net https://unpkg.com https://gleitz.github.io https://smpldsnds.github.io https://goldst.dev; font-src 'self' data: https://cdn.jsdelivr.net; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'` | (미확인) | |
| strict-transport-security | 설정 없음 | (미확인) | 운영에만 있을 가능성(Vercel이 자동으로 붙임) |
| x-content-type-options | `nosniff` | (미확인) | |
| referrer-policy | `strict-origin-when-cross-origin` | (미확인) | |
| permissions-policy | `midi=(self), camera=(), microphone=(), geolocation=()` | (미확인) | |

## 1-4에서 다룰 것
- CSP의 `script-src`·`connect-src`·`font-src`에서 `cdn.jsdelivr.net`·`unpkg.com`을 뺀다(CDN 대체 경로 제거).
- 운영 값이 위와 다르면(다름 / 운영에만 있음) 이 표에 적고 1-4 보고에 포함한다.
