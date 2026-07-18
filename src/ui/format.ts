/** 円を「万円」表記に（理事会向けに桁を読みやすく） */
export function yen2man(yen: number): string {
  const man = yen / 10_000
  return `${man.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}万円`
}

/** 円をそのまま ¥ 表記に */
export function yen(value: number): string {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`
}

/** パーセント表記 */
export function pct(decimalOrPct: number, fromDecimal = false): string {
  const v = fromDecimal ? decimalOrPct * 100 : decimalOrPct
  return `${v.toLocaleString('ja-JP', { maximumFractionDigits: 3 })}%`
}
