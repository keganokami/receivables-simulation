import { AssociationInput, BondStrategy, OtherCashflow, RepairItem } from './types'

// ============================================================================
// サンプルデータ（築4年・50戸の新築マンションを想定）
//
// ★実データ（長期修繕計画・過去収支）が揃ったら、この値を差し替えるだけで
//   本番のシミュレーションになる。数値はすべて仮の検討用。
// ============================================================================

const START_YEAR = 2026
const HORIZON = 30 // 2026〜2055

// その他収支：駐車場収入などの経常的な収入を毎年計上（仮 60万円/年）
const recurringOther: OtherCashflow[] = []
for (let y = START_YEAR; y < START_YEAR + HORIZON; y++) {
  recurringOther.push({ year: y, amount: 600_000, note: '駐車場収入等（経常）' })
}

// 長期修繕計画（支出）：大規模修繕＋中間の計画修繕（仮）
const repairPlan: RepairItem[] = [
  { year: 2030, amount: 5_000_000, label: '計画修繕（共用部設備・小規模）' },
  { year: 2034, amount: 80_000_000, label: '第1回 大規模修繕（外壁・防水等）' },
  { year: 2040, amount: 10_000_000, label: '計画修繕（給排水・機械設備）' },
  { year: 2046, amount: 120_000_000, label: '第2回 大規模修繕' },
  { year: 2052, amount: 12_000_000, label: '計画修繕（エレベーター更新等）' },
]

export const SAMPLE_INPUT: AssociationInput = {
  name: 'サンプルマンション（築4年・50戸）',
  units: 50,
  builtYear: 2022,
  startYear: START_YEAR,
  horizonYears: HORIZON,
  openingBalance: 15_000_000, // 開始時点の積立金残高（仮）
  // 段階増額方式：戸あたり月額が段階的に上がる計画（仮）
  reserveSteps: [
    { fromYear: 2022, monthlyPerUnit: 7_000 },
    { fromYear: 2027, monthlyPerUnit: 9_000 },
    { fromYear: 2032, monthlyPerUnit: 12_000 },
    { fromYear: 2037, monthlyPerUnit: 16_000 },
    { fromYear: 2042, monthlyPerUnit: 18_000 },
  ],
  repairPlan,
  otherCashflows: recurringOther,
  isCertified: false,
  inflationRate: 0.02,
}

export const SAMPLE_STRATEGY: BondStrategy = {
  enabled: true,
  startYear: 2026,
  unitsPerYear: 4, // 毎年4口=200万円を継続購入（仮）
  purchaseYears: 10,
  allowEarlyRedemption: true,
}
