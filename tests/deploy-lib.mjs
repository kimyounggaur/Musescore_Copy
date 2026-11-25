// 배포 뒤 점검(verify-deploy.mjs)과 단위 테스트가 함께 쓰는 판정 함수. (프롬프트북 P3-6)

/** 응답의 Content-Security-Policy 값에서 문제를 찾는다. 문제가 없으면 빈 목록. */
export function inspectCsp(header) {
  if (!header) return ['Content-Security-Policy 헤더가 없어요'];
  const problems = [];
  if (/jsdelivr|unpkg/i.test(header)) problems.push('CSP에 외부 CDN(jsdelivr·unpkg)이 들어 있어요');
  const directives = new Map();
  for (const part of header.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), values);
  }
  const script = directives.get('script-src');
  if (!script) problems.push('script-src가 없어요');
  else if (script.length !== 1 || script[0] !== "'self'") problems.push(`script-src가 'self'뿐이 아니에요: ${script.join(' ')}`);
  return problems;
}
