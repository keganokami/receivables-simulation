import { describe, it, expect } from 'vitest'
import { simulate, simulateWithoutBond } from './simulate'
import { AssociationInput, BondStrategy, RateScenario, BOND_UNIT_YEN } from './types'

function baseInput(overrides: Partial<AssociationInput> = {}): AssociationInput {
  return {
    name: 'test',
    units: 100,
    builtYear: 2022,
    startYear: 2026,
    horizonYears: 12,
    openingBalance: 0,
    reserveSteps: [{ fromYear: 2022, monthlyPerUnit: 10_000 }],
    repairPlan: [],
    otherCashflows: [],
    isCertified: false,
    inflationRate: 0,
    ...overrides,
  }
}

const flatRate: RateScenario = {
  name: 'flat',
  description: '',
  bondRatesByYear: { 2026: 1.0 }, // 1.0%
  certifiedBonus: 0.05,
  depositRate: 0, // 預金利息ゼロで挙動を単純化
}

const noBond: BondStrategy = {
  enabled: false,
  startYear: 2026,
  unitsPerYear: 0,
  purchaseYears: 0,
  allowEarlyRedemption: false,
}

describe('修繕積立金収入', () => {
  it('戸あたり月額 × 戸数 × 12 を年収入として計上する', () => {
    const res = simulate(baseInput(), flatRate, noBond)
    // 10,000 × 100 × 12 = 12,000,000
    expect(res.rows[0].reserveIncome).toBe(12_000_000)
  })

  it('段階増額で年度ごとに月額が切り替わる', () => {
    const input = baseInput({
      reserveSteps: [
        { fromYear: 2022, monthlyPerUnit: 10_000 },
        { fromYear: 2028, monthlyPerUnit: 15_000 },
      ],
    })
    const res = simulate(input, flatRate, noBond)
    expect(res.rows[0].reserveIncome).toBe(12_000_000) // 2026
    expect(res.rows[2].reserveIncome).toBe(18_000_000) // 2028以降 15,000×100×12
  })
})

describe('すまい・る債', () => {
  const buyStrategy: BondStrategy = {
    enabled: true,
    startYear: 2026,
    unitsPerYear: 1,
    purchaseYears: 1, // 初年度のみ1口購入
    allowEarlyRedemption: false,
  }

  it('購入年に元本が債券へ移り、流動資金が減る', () => {
    const input = baseInput({ openingBalance: 5_000_000 })
    const res = simulate(input, flatRate, buyStrategy)
    expect(res.rows[0].bondPurchase).toBe(BOND_UNIT_YEN)
    expect(res.rows[0].bondHoldings).toBe(BOND_UNIT_YEN)
  })

  it('利息は発行翌年から満期年まで毎年受け取る（購入年は受取なし）', () => {
    const input = baseInput({ openingBalance: 5_000_000 })
    const res = simulate(input, flatRate, buyStrategy)
    // 認定なし → 利率1.0%、元本50万 → 利息5,000円/年
    expect(res.rows[0].bondInterest).toBe(0) // 購入年は受取なし
    expect(res.rows[1].bondInterest).toBeCloseTo(5_000) // 翌年から
    // 発行(2026)+10年=2036年が満期。利息受取は2027〜2036の10回。
    const interestYears = res.rows.filter((r) => r.bondInterest > 0)
    expect(interestYears.length).toBe(10)
  })

  it('発行+10年で元本が償還され債券残高がゼロに戻る', () => {
    const input = baseInput({ openingBalance: 5_000_000, horizonYears: 12 })
    const res = simulate(input, flatRate, buyStrategy)
    const maturityRow = res.rows.find((r) => r.year === 2036)!
    expect(maturityRow.maturedPrincipal).toBe(BOND_UNIT_YEN)
    expect(maturityRow.bondHoldings).toBe(0)
  })

  it('認定マンションは利率が上乗せされる', () => {
    const input = baseInput({ openingBalance: 5_000_000, isCertified: true })
    const res = simulate(input, flatRate, buyStrategy)
    // 利率 1.0% + 0.05% = 1.05% → 50万 × 1.05% = 5,250円
    expect(res.rows[1].bondInterest).toBeCloseTo(5_250)
  })

  it('購入上限（年間積立金＋前年度末残高）を超えて買わない', () => {
    // 上限 = 年間積立金 + 前年度末残高。残高0・積立金も小さくして上限を縛る。
    // 手元資金はその他収入で潤沢にしておき、「資金はあるが上限で買えない」を検証。
    const input = baseInput({
      units: 1,
      openingBalance: 0,
      reserveSteps: [{ fromYear: 2022, monthlyPerUnit: 10_000 }], // 年12万円のみ
      otherCashflows: [{ year: 2026, amount: 100_000_000, note: '潤沢な手元資金' }],
    })
    const greedy: BondStrategy = { ...buyStrategy, unitsPerYear: 50 }
    const res = simulate(input, flatRate, greedy)
    // 上限 = (120,000 + 0) / 500,000 = 0口 → 資金はあっても購入できない
    expect(res.rows[0].bondPurchase).toBe(0)
  })
})

describe('積立金の引き上げ', () => {
  it('reserveBoost で fromYear 以降の積立金収入に定額が上乗せされる', () => {
    const input = baseInput({
      reserveBoost: { fromYear: 2028, addAnnual: 6_000_000 },
    })
    const res = simulate(input, flatRate, noBond)
    expect(res.rows[0].reserveIncome).toBe(12_000_000) // 2026 据え置き
    expect(res.rows[2].reserveIncome).toBe(18_000_000) // 2028以降 +600万/年
  })

  it('積立金を引き上げると資金ショートが解消しうる', () => {
    const base = baseInput({
      openingBalance: 1_000_000,
      reserveSteps: [{ fromYear: 2022, monthlyPerUnit: 5_000 }],
      repairPlan: [{ year: 2032, amount: 60_000_000, label: '大規模修繕' }],
    })
    const before = simulate(base, flatRate, noBond)
    expect(before.hasShortfall).toBe(true)
    const boosted = simulate(
      { ...base, reserveBoost: { fromYear: 2026, addAnnual: 4_000_000 } },
      flatRate,
      noBond
    )
    expect(boosted.hasShortfall).toBe(false)
  })
})

describe('物価上昇', () => {
  it('修繕支出は基準年からの経過年数で escalation する', () => {
    const input = baseInput({
      inflationRate: 0.02,
      repairPlan: [{ year: 2028, amount: 10_000_000, label: 'x' }],
    })
    const res = simulate(input, flatRate, noBond)
    const row = res.rows.find((r) => r.year === 2028)!
    // 2026基準 → 2028は2年分 (1.02)^2
    expect(row.repairExpense).toBeCloseTo(10_000_000 * 1.02 ** 2)
  })
})

describe('資金ショート', () => {
  it('支出が資産を上回るとショートを検知する', () => {
    const input = baseInput({
      openingBalance: 1_000_000,
      reserveSteps: [{ fromYear: 2022, monthlyPerUnit: 0 }],
      repairPlan: [{ year: 2027, amount: 50_000_000, label: '大規模修繕' }],
      otherCashflows: [],
    })
    const res = simulate(input, flatRate, noBond)
    expect(res.hasShortfall).toBe(true)
    expect(res.firstShortfallYear).toBe(2027)
  })

  it('十分な積立があればショートしない', () => {
    const input = baseInput({
      openingBalance: 100_000_000,
      repairPlan: [{ year: 2027, amount: 50_000_000, label: '大規模修繕' }],
    })
    const res = simulate(input, flatRate, noBond)
    expect(res.hasShortfall).toBe(false)
  })
})

describe('すまい・る債 継続購入ルール（同一口数）', () => {
  it('初回と同一口数を維持して継続購入する', () => {
    // 十分な資金があれば毎年同一口数(3口)を購入し続ける
    const input = baseInput({ openingBalance: 50_000_000 })
    const strategy: BondStrategy = {
      enabled: true,
      startYear: 2026,
      unitsPerYear: 3,
      purchaseYears: 5,
      allowEarlyRedemption: false,
    }
    const res = simulate(input, flatRate, strategy)
    // 購入ウィンドウ内の各年: 2026〜2030 は全て 3口×50万=150万円購入
    for (let y = 2026; y <= 2030; y++) {
      const row = res.rows.find(r => r.year === y)!
      expect(row.bondPurchase).toBe(3 * BOND_UNIT_YEN)
    }
    // 2031以降は購入しない
    const row2031 = res.rows.find(r => r.year === 2031)!
    expect(row2031.bondPurchase).toBe(0)
  })

  it('初回に全量買えない場合はシリーズが不成立（以降も購入しない）', () => {
    // openingBalance=0, 積立金収入のみ（年12万）→ 上限0口 → 初回に3口買えない
    const input = baseInput({
      openingBalance: 0,
      units: 1,
      reserveSteps: [{ fromYear: 2022, monthlyPerUnit: 10_000 }], // 年12万
      otherCashflows: [],
    })
    const strategy: BondStrategy = {
      enabled: true,
      startYear: 2026,
      unitsPerYear: 3,
      purchaseYears: 5,
      allowEarlyRedemption: false,
    }
    const res = simulate(input, flatRate, strategy)
    // 全年度で購入0
    expect(res.rows.every(r => r.bondPurchase === 0)).toBe(true)
  })

  it('途中で同一口数を買えなくなったらシリーズを終了（部分購入なし）', () => {
    // 初年度は十分な資金があるが、翌年以降は資金不足になる設定
    // openingBalance = 2,000,000
    // 積立金年収入 = 120,000 (1戸×月1万×12)
    // 翌年: 大きな修繕支出で資金が減り、3口(150万)を買えない
    const input = baseInput({
      openingBalance: 2_000_000,
      units: 1,
      reserveSteps: [{ fromYear: 2022, monthlyPerUnit: 10_000 }],
      repairPlan: [{ year: 2027, amount: 1_800_000, label: 'test' }], // 翌年に大きな支出
      otherCashflows: [],
    })
    const strategy: BondStrategy = {
      enabled: true,
      startYear: 2026,
      unitsPerYear: 3,
      purchaseYears: 5,
      allowEarlyRedemption: false,
    }
    const res = simulate(input, flatRate, strategy)
    // 2026年: 3口購入できる
    const row2026 = res.rows.find(r => r.year === 2026)!
    expect(row2026.bondPurchase).toBe(3 * BOND_UNIT_YEN)
    // 2027: 修繕支出で資金が減り、シリーズ終了 → 購入0
    const row2027 = res.rows.find(r => r.year === 2027)!
    expect(row2027.bondPurchase).toBe(0)
    // 2028以降も購入しない
    const row2028 = res.rows.find(r => r.year === 2028)!
    expect(row2028.bondPurchase).toBe(0)
  })
})

describe('物価上昇の基準年（priceBaseYear）', () => {
  it('priceBaseYear を設定すると startYear でなく priceBaseYear からの経過年で escalation する', () => {
    const input = baseInput({
      startYear: 2026,
      inflationRate: 0.02,
      priceBaseYear: 2022,
      repairPlan: [{ year: 2028, amount: 10_000_000, label: 'x' }],
    })
    const res = simulate(input, flatRate, noBond)
    const row = res.rows.find(r => r.year === 2028)!
    // 基準年2022 → 2028は6年分 (1.02)^6
    expect(row.repairExpense).toBeCloseTo(10_000_000 * 1.02 ** 6)
  })

  it('priceBaseYear 未設定時は startYear を基準にする（後方互換）', () => {
    const input = baseInput({
      startYear: 2026,
      inflationRate: 0.02,
      repairPlan: [{ year: 2028, amount: 10_000_000, label: 'x' }],
    })
    const res = simulate(input, flatRate, noBond)
    const row = res.rows.find(r => r.year === 2028)!
    // startYear=2026 → 2028は2年分 (1.02)^2
    expect(row.repairExpense).toBeCloseTo(10_000_000 * 1.02 ** 2)
  })
})

describe('資金ショート（総資産ベース）', () => {
  it('債券保有があっても総資産がマイナスになった場合のみショートとする', () => {
    // 流動資金はマイナスだが債券保有があって総資産はプラス → ショートなし
    // openingBalance=0, income=12M/年(100戸×月1万×12)
    // year 2026: income 12M, repair 0, purchase 20 units (10M) → liquid=2M, bonds=10M
    // year 2027: income 12M, liquid = 2M+12M=14M, repair 20M → liquid=-6M, bonds=10M, total=4M
    //   shortfall check: total = -6M + 10M = 4M > 0 → NO shortfall
    const input2 = baseInput({
      openingBalance: 0,
      reserveSteps: [{ fromYear: 2022, monthlyPerUnit: 10_000 }],
      repairPlan: [{ year: 2027, amount: 20_000_000, label: '大規模修繕' }],
    })
    const strat2: BondStrategy = {
      enabled: true,
      startYear: 2026,
      unitsPerYear: 20,
      purchaseYears: 1, // 初年のみ20口=1000万
      allowEarlyRedemption: false,
    }
    const res2 = simulate(input2, flatRate, strat2)
    const r27 = res2.rows.find(r => r.year === 2027)!
    // liquid in 2027 after repair = ~2M + 12M - 20M = -6M (negative)
    // bonds = 10M
    // total = 4M > 0 → no shortfall
    expect(r27.liquidEnd).toBeLessThan(0) // 流動資金はマイナス
    expect(r27.totalEnd).toBeGreaterThan(0) // 総資産はプラス
    expect(r27.shortfall).toBe(false) // ショートなし（総資産ベース）
  })
})

describe('運用あり vs なし の比較', () => {
  it('すまい・る債運用は預金より累計利息が多い（同条件）', () => {
    const input = baseInput({ openingBalance: 50_000_000, horizonYears: 12 })
    const withBond = simulate(input, flatRate, {
      enabled: true,
      startYear: 2026,
      unitsPerYear: 10, // 毎年500万円
      purchaseYears: 10,
      allowEarlyRedemption: true,
    })
    const without = simulateWithoutBond(input, flatRate)
    // 預金利率0%・債券利率1.0% → 運用ありの方が利息も期末資産も多い
    expect(withBond.totalInterest).toBeGreaterThan(without.totalInterest)
    expect(withBond.endingTotal).toBeGreaterThan(without.endingTotal)
  })
})
