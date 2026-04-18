/**
 * 법령목록 CSV 한 줄 파싱 (RFC 4180에 가깝게: 쌍따옴표 필드 안의 쉼표는 구분자 아님)
 * 엑셀에서 "부처1,부처2" 형태로 내보낸 행에서 열 밀림 방지
 */

export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === "," && !inQuotes) {
      result.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  result.push(cur.trim());
  return result;
}
