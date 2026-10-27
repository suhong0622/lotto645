"""
로또 6/45 새 회차를 공개 JSON에서 받아 data/lotto645.js 에 추가하는 스크립트.

데이터 출처: smok95/lotto (1회~최신 회차 전체를 JSON으로 공개)
  https://raw.githubusercontent.com/smok95/lotto/main/results/all.json

연금복권 때처럼 웹페이지를 긁는(스크래핑) 방식이 아니라 정해진 형식의 JSON을
그대로 읽기 때문에, 사이트 디자인이 바뀌어도 깨지지 않는다.

동작 규칙
- 이미 있는 회차는 건드리지 않는다 (값이 다르면 경고만 출력).
- 새 회차만 추가한다. 추가 전에 번호 범위/중복/보너스를 전부 검증한다.
- 결과가 1~최신 회차까지 빠진 회차 없이 이어지지 않으면 실패(exit 1) 처리한다.
  -> GitHub Actions에 빨간 X가 떠서 문제를 바로 알 수 있다.
- 새 회차가 없으면 정상 종료(exit 0)한다.

환경 변수 (테스트용, 평소엔 필요 없음)
  LOTTO_SOURCE_URL : 데이터 주소 (file:// 도 가능)
  LOTTO_DATA_PATH  : 갱신할 data 파일 경로
"""

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

SOURCE_URL = os.environ.get(
    "LOTTO_SOURCE_URL",
    "https://raw.githubusercontent.com/smok95/lotto/main/results/all.json",
)
DATA_PATH = Path(
    os.environ.get(
        "LOTTO_DATA_PATH",
        Path(__file__).resolve().parent.parent / "data" / "lotto645.js",
    )
)


def fetch_source() -> list:
    req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "lotto645-archive-bot/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = json.loads(resp.read().decode("utf-8"))
    if not isinstance(raw, list) or not raw:
        raise RuntimeError("소스 JSON이 비어있거나 배열이 아닙니다.")
    return raw


def normalize(item: dict):
    """소스 항목 1개를 검증하고 우리 형식으로 변환. 문제가 있으면 ValueError."""
    d = item.get("draw_no")
    nums = item.get("numbers")
    bonus = item.get("bonus_no")
    date = item.get("date")
    if not isinstance(d, int) or d < 1:
        raise ValueError(f"회차 형식 오류: {d!r}")
    if not (
        isinstance(nums, list)
        and len(nums) == 6
        and len(set(nums)) == 6
        and all(isinstance(x, int) and 1 <= x <= 45 for x in nums)
    ):
        raise ValueError(f"{d}회 당첨번호 오류: {nums!r}")
    if not (isinstance(bonus, int) and 1 <= bonus <= 45 and bonus not in nums):
        raise ValueError(f"{d}회 보너스 번호 오류: {bonus!r}")
    if not (isinstance(date, str) and re.match(r"^\d{4}-\d{2}-\d{2}", date)):
        raise ValueError(f"{d}회 날짜 오류: {date!r}")
    return {"round": d, "date": date[:10], "numbers": sorted(nums), "bonus": bonus}


def load_existing() -> list:
    content = DATA_PATH.read_text(encoding="utf-8")
    m = re.search(r"const LOTTO_DATA\s*=\s*(\[.*\]);", content, re.S)
    if not m:
        raise RuntimeError(f"{DATA_PATH} 에서 LOTTO_DATA 배열을 찾지 못했습니다.")
    return json.loads(m.group(1))


def save(records: list) -> None:
    records = sorted(records, key=lambda r: r["round"])
    body = (
        f"// 로또 6/45 1회~{len(records)}회 당첨번호 데이터\n"
        "// 자동 갱신: GitHub Actions (scripts/update_data.py), 출처: smok95/lotto 공개 JSON\n"
        "// 참고용 데이터이며, 정확한 당첨번호는 dhlottery.co.kr 에서 확인하세요.\n"
        "const LOTTO_DATA = " + json.dumps(records, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    DATA_PATH.write_text(body, encoding="utf-8")


def main() -> int:
    existing = load_existing()
    by_round = {r["round"]: r for r in existing}
    before_max = max(by_round)

    source = fetch_source()
    print(f"소스에서 {len(source)}개 회차를 읽었습니다.")

    added, mismatched = [], []
    for item in source:
        try:
            rec = normalize(item)
        except ValueError as e:
            print(f"오류: {e}")
            return 1
        rnd = rec["round"]
        if rnd not in by_round:
            by_round[rnd] = rec
            added.append(rnd)
        elif by_round[rnd] != rec:
            mismatched.append(rnd)

    if mismatched:
        print(f"경고: 기존 값과 소스 값이 다른 회차 {mismatched[:10]} (기존 값 유지, 확인 필요)")

    rounds = sorted(by_round)
    missing = sorted(set(range(1, rounds[-1] + 1)) - set(rounds))
    if missing:
        print(f"오류: 빠진 회차가 있습니다 {missing[:10]} — 저장하지 않고 종료합니다.")
        return 1

    if not added:
        print(f"새 회차 없음 (현재 최신 회차: {before_max}회)")
        return 0

    save(list(by_round.values()))
    print(f"추가된 회차: {sorted(added)} (총 {len(by_round)}회차, 최신 {rounds[-1]}회)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # 네트워크 오류 등: 숨기지 않고 실패로 드러낸다
        print(f"실패: {type(e).__name__}: {e}")
        sys.exit(1)
