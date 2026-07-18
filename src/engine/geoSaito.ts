import { AssociationInput, BondStrategy, RepairItem } from './types'

// ============================================================================
// ジオ彩都いろどりの丘（団地）実データ
//
// 出典: 収支報告書(第1・2期) / 長期修繕計画書(団地・ABC棟・DE棟, 2023年2月)
// 会計年度は 9月〜8月。金額は円。
//
// - 修繕積立金は「団地／ABC棟／DE棟」の3会計に分離。
// - 開始残高は第2期末(2025/8/31)の次期繰越。
// - 修繕積立金の年間収入・大規模修繕支出は長期修繕計画の年度別数値。
// - 長期修繕計画は2022年1月単価・物価変動を見込まないため、
//   将来のインフレはアプリの物価上昇率スライダーで別途反映する。
// ============================================================================

const K = 1_000 // 千円 → 円

interface AccountSource {
  key: 'danchi' | 'abc' | 'de'
  name: string
  units: number
  /** 専有面積合計（㎡） */
  senyuArea: number
  openingBalance: number
  /** 修繕積立金 年間収入（円/年）の段階 */
  reserveAnnualSteps: { fromYear: number; annual: number }[]
  /** 長期修繕計画の支出 */
  repairPlan: RepairItem[]
}

const DANCHI: AccountSource = {
  key: 'danchi',
  name: '団地会計',
  units: 372,
  senyuArea: 30_438.28,
  openingBalance: 36_984_496,
  reserveAnnualSteps: [
    { fromYear: 2026, annual: 7_323 * K },
    { fromYear: 2028, annual: 14_625 * K },
    { fromYear: 2033, annual: 21_931 * K },
    { fromYear: 2038, annual: 29_238 * K },
    { fromYear: 2043, annual: 32_890 * K },
  ],
  repairPlan: [
    { year: 2027, amount: 5_481 * K, label: '団地: 計画修繕' },
    { year: 2028, amount: 8_782 * K, label: '団地: 計画修繕' },
    { year: 2029, amount: 9_016 * K, label: '団地: 計画修繕' },
    { year: 2030, amount: 2_180 * K, label: '団地: 計画修繕' },
    { year: 2032, amount: 24_076 * K, label: '団地: 計画修繕' },
    { year: 2034, amount: 48_833 * K, label: '団地: 外構・鉄部等' },
    { year: 2036, amount: 9_016 * K, label: '団地: 計画修繕' },
    { year: 2037, amount: 5_976 * K, label: '団地: 計画修繕' },
    { year: 2038, amount: 2_180 * K, label: '団地: 計画修繕' },
    { year: 2040, amount: 8_782 * K, label: '団地: 計画修繕' },
    { year: 2042, amount: 32_370 * K, label: '団地: 外構・鉄部等' },
    { year: 2043, amount: 9_016 * K, label: '団地: 計画修繕' },
    { year: 2046, amount: 99_623 * K, label: '団地: 大規模修繕(外構等)' },
    { year: 2047, amount: 10_101 * K, label: '団地: 計画修繕' },
    { year: 2052, amount: 445_280 * K, label: '団地: 機械式駐車場 全取替ほか(2052年度)' },
  ],
}

const ABC: AccountSource = {
  key: 'abc',
  name: 'ABC棟',
  units: 202,
  senyuArea: 16_594.48,
  openingBalance: 91_993_071,
  reserveAnnualSteps: [
    { fromYear: 2026, annual: 15_941 * K },
    { fromYear: 2028, annual: 23_904 * K },
    { fromYear: 2033, annual: 29_881 * K },
    { fromYear: 2038, annual: 35_856 * K },
    { fromYear: 2043, annual: 41_827 * K },
  ],
  repairPlan: [
    { year: 2027, amount: 440 * K, label: 'ABC: 計画修繕' },
    { year: 2028, amount: 9_614 * K, label: 'ABC: 計画修繕' },
    { year: 2030, amount: 7_766 * K, label: 'ABC: 計画修繕' },
    { year: 2032, amount: 5_126 * K, label: 'ABC: 計画修繕' },
    { year: 2034, amount: 293_304 * K, label: 'ABC: 第1回 大規模修繕' },
    { year: 2037, amount: 43_626 * K, label: 'ABC: 給排水・設備等' },
    { year: 2038, amount: 21_166 * K, label: 'ABC: 設備更新' },
    { year: 2040, amount: 9_614 * K, label: 'ABC: 計画修繕' },
    { year: 2042, amount: 24_563 * K, label: 'ABC: 計画修繕' },
    { year: 2044, amount: 1_650 * K, label: 'ABC: 調査・設計' },
    { year: 2046, amount: 327_939 * K, label: 'ABC: 第2回 大規模修繕' },
    { year: 2047, amount: 13_838 * K, label: 'ABC: 計画修繕' },
    { year: 2052, amount: 113_476 * K, label: 'ABC: 設備更新等' },
  ],
}

const DE: AccountSource = {
  key: 'de',
  name: 'DE棟',
  units: 170,
  senyuArea: 13_843.80,
  openingBalance: 55_464_742,
  reserveAnnualSteps: [
    { fromYear: 2026, annual: 13_297 * K },
    { fromYear: 2029, annual: 23_263 * K },
    { fromYear: 2034, annual: 28_248 * K },
    { fromYear: 2039, annual: 34_891 * K },
    { fromYear: 2044, annual: 38_215 * K },
  ],
  repairPlan: [
    { year: 2028, amount: 440 * K, label: 'DE: 計画修繕' },
    { year: 2029, amount: 10_571 * K, label: 'DE: 計画修繕' },
    { year: 2031, amount: 6_776 * K, label: 'DE: 計画修繕' },
    { year: 2033, amount: 6_347 * K, label: 'DE: 計画修繕' },
    { year: 2035, amount: 268_807 * K, label: 'DE: 第1回 大規模修繕' },
    { year: 2038, amount: 47_960 * K, label: 'DE: 給排水・設備等' },
    { year: 2039, amount: 21_683 * K, label: 'DE: 設備更新' },
    { year: 2041, amount: 10_571 * K, label: 'DE: 計画修繕' },
    { year: 2043, amount: 31_713 * K, label: 'DE: 計画修繕' },
    { year: 2045, amount: 1_650 * K, label: 'DE: 調査・設計' },
    { year: 2047, amount: 293_667 * K, label: 'DE: 第2回 大規模修繕' },
    { year: 2048, amount: 13_596 * K, label: 'DE: 計画修繕' },
    { year: 2053, amount: 97_988 * K, label: 'DE: 設備更新等' },
  ],
}

export const ACCOUNTS: AccountSource[] = [DANCHI, ABC, DE]

const START_YEAR = 2026
const HORIZON = 30 // 2026〜2055

function annualOf(steps: { fromYear: number; annual: number }[], year: number): number {
  let v = 0
  let best = -Infinity
  for (const s of steps) {
    if (s.fromYear <= year && s.fromYear > best) {
      best = s.fromYear
      v = s.annual
    }
  }
  return v
}

/** 3会計を合算した「団地全体」の入力を生成 */
function buildCombined(): AssociationInput {
  // 合算した年間収入の変化点を作る
  const reserveAnnualSteps: { fromYear: number; annual: number }[] = []
  let prev = -1
  for (let y = START_YEAR; y < START_YEAR + HORIZON; y++) {
    const sum = ACCOUNTS.reduce((s, a) => s + annualOf(a.reserveAnnualSteps, y), 0)
    if (sum !== prev) {
      reserveAnnualSteps.push({ fromYear: y, annual: sum })
      prev = sum
    }
  }
  return {
    name: 'ジオ彩都いろどりの丘（団地全体）',
    // 団地会計は全戸対象の共用施設会計。総戸数は棟の合計（ABC+DE）＝ 372戸。
    units: ABC.units + DE.units,
    builtYear: 2023,
    startYear: START_YEAR,
    horizonYears: HORIZON,
    openingBalance: ACCOUNTS.reduce((s, a) => s + a.openingBalance, 0),
    reserveSteps: [],
    reserveAnnualSteps,
    senyuArea: ABC.senyuArea + DE.senyuArea, // = 30,438.28㎡（全体）
    repairPlan: ACCOUNTS.flatMap((a) => a.repairPlan),
    otherCashflows: [],
    isCertified: false,
    inflationRate: 0, // 長期修繕計画は物価変動を見込まない（スライダーで調整）
    priceBaseYear: 2022,
  }
}

/** 1会計分の入力を生成（棟別シミュレーション用） */
export function accountInput(acc: AccountSource): AssociationInput {
  return {
    name: `ジオ彩都いろどりの丘（${acc.name}）`,
    units: acc.units,
    builtYear: acc.key === 'de' ? 2024 : 2023,
    startYear: START_YEAR,
    horizonYears: HORIZON,
    openingBalance: acc.openingBalance,
    reserveSteps: [],
    reserveAnnualSteps: acc.reserveAnnualSteps,
    senyuArea: acc.senyuArea,
    repairPlan: acc.repairPlan,
    otherCashflows: [],
    isCertified: false,
    inflationRate: 0,
    priceBaseYear: 2022,
  }
}

export const GEO_SAITO_COMBINED: AssociationInput = buildCombined()

/** 既定のすまい・る債戦略（検討の出発点） */
export const GEO_SAITO_STRATEGY: BondStrategy = {
  enabled: true,
  startYear: 2026,
  unitsPerYear: 60, // 毎年60口=3,000万円を継続購入（検討の初期値）
  purchaseYears: 10,
  allowEarlyRedemption: true,
}
