import { describe, it, expect } from 'vitest'
import { findOptimalUnits, requiredMonthlyIncrease, buildReportData, evaluatePlan } from './report'
import { GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY } from './geoSaito'
import { RATE_SCENARIOS } from './scenarios'
import { AssociationInput, BondStrategy, RateScenario } from './types'
import { simulate } from './simulate'

const standard = RATE_SCENARIOS[1] // 標準シナリオ
const flat = RATE_SCENARIOS[0]     // 横ばい

// ============================================================
// 実装1: findOptimalUnits テスト
// ============================================================

describe('findOptimalUnits', () => {
  it('GEO_SAITO_COMBINED・標準シナリオで妥当な最適口数を返す（100〜200口/年の範囲）', () => {
    const result = findOptimalUnits(GEO_SAITO_COMBINED, standard)
    // 既検証: 約140口でメリット最大
    expect(result.optimalUnits).toBeGreaterThanOrEqual(100)
    expect(result.optimalUnits).toBeLessThanOrEqual(200)
    expect(result.optimalBenefit).toBeGreaterThan(0)
  })

  it('maxContinuousUnits が optimalUnits 以下になる（上限超えで打ち切り発生）', () => {
    const result = findOptimalUnits(GEO_SAITO_COMBINED, standard)
    // maxContinuousUnits <= optimalUnits（上限を超えると逆効果）
    expect(result.maxContinuousUnits).toBeLessThanOrEqual(result.optimalUnits)
  })

  it('maxContinuousUnits+10口では10年継続購入が打ち切られる', () => {
    const result = findOptimalUnits(GEO_SAITO_COMBINED, standard)
    const limitPlusOne = result.maxContinuousUnits + 10
    const res = simulate(GEO_SAITO_COMBINED, standard, {
      enabled: true,
      startYear: GEO_SAITO_COMBINED.startYear,
      unitsPerYear: limitPlusOne,
      purchaseYears: 10,
      allowEarlyRedemption: true,
    })
    const purchases = res.rows.slice(0, 10).map((r) => r.bondPurchase)
    // 少なくともどこかで購入が0になる（打ち切り発生）
    expect(purchases.some((p) => p === 0)).toBe(true)
  })

  it('maxContinuousUnits 口では10年間連続購入できる', () => {
    const result = findOptimalUnits(GEO_SAITO_COMBINED, standard)
    if (result.maxContinuousUnits === 0) return // スキップ
    const res = simulate(GEO_SAITO_COMBINED, standard, {
      enabled: true,
      startYear: GEO_SAITO_COMBINED.startYear,
      unitsPerYear: result.maxContinuousUnits,
      purchaseYears: 10,
      allowEarlyRedemption: true,
    })
    const purchases = res.rows.slice(0, 10).map((r) => r.bondPurchase)
    expect(purchases.every((p) => p > 0)).toBe(true)
  })

  it('資金が十分あれば最適口数が正の値で返る（シンプルケース）', () => {
    // 潤沢な資金・修繕計画なし → 高い口数まで継続購入できる
    const richInput: AssociationInput = {
      name: 'test',
      units: 200,
      builtYear: 2020,
      startYear: 2026,
      horizonYears: 30,
      openingBalance: 2_000_000_000,
      reserveSteps: [{ fromYear: 2026, monthlyPerUnit: 20_000 }],
      repairPlan: [],
      otherCashflows: [],
      isCertified: false,
      inflationRate: 0,
    }
    const result = findOptimalUnits(richInput, flat)
    // 資金十分なら optimalUnits > 0
    expect(result.optimalUnits).toBeGreaterThan(0)
    // maxContinuousUnits も十分高い
    expect(result.maxContinuousUnits).toBeGreaterThan(0)
  })
})

// ============================================================
// 実装2: requiredMonthlyIncrease テスト
// ============================================================

describe('requiredMonthlyIncrease', () => {
  it('ショートがない場合は 0 を返す（GEO_SAITO・物価0%）', () => {
    const result = requiredMonthlyIncrease(
      { ...GEO_SAITO_COMBINED, inflationRate: 0 },
      standard,
      GEO_SAITO_STRATEGY
    )
    expect(result).toBe(0)
  })

  it('物価2%でショートが発生する場合は正の値を返す', () => {
    const input2 = { ...GEO_SAITO_COMBINED, inflationRate: 0.02 }
    const result = requiredMonthlyIncrease(input2, standard, GEO_SAITO_STRATEGY)
    expect(result).toBeGreaterThan(0)
  })

  it('運用なしより運用ありの方が必要引き上げ額が小さい（または同じ）', () => {
    const input2 = { ...GEO_SAITO_COMBINED, inflationRate: 0.02 }
    const noBondStrat: BondStrategy = {
      enabled: false,
      startYear: GEO_SAITO_STRATEGY.startYear,
      unitsPerYear: 0,
      purchaseYears: 0,
      allowEarlyRedemption: false,
    }
    const withBond = requiredMonthlyIncrease(input2, standard, GEO_SAITO_STRATEGY)
    const withoutBond = requiredMonthlyIncrease(input2, standard, noBondStrat)
    // 運用ありの方が必要引き上げが小さい（あるいは同じ）
    expect(withBond).toBeLessThanOrEqual(withoutBond)
  })

  it('inflationRate=0 かつ運用なしでも 0 を返す（ショートなしケース）', () => {
    const noBond: BondStrategy = {
      enabled: false,
      startYear: GEO_SAITO_STRATEGY.startYear,
      unitsPerYear: 0,
      purchaseYears: 0,
      allowEarlyRedemption: false,
    }
    const result = requiredMonthlyIncrease(
      { ...GEO_SAITO_COMBINED, inflationRate: 0 },
      standard,
      noBond
    )
    expect(result).toBe(0)
  })

  it('シンプルな資金ショートケースで正しく最小必要額を算出し、その額で解消を確認', () => {
    const scenario: RateScenario = {
      name: 'flat',
      description: '',
      bondRatesByYear: { 2026: 1.0 },
      certifiedBonus: 0,
      depositRate: 0,
    }
    const noBond: BondStrategy = {
      enabled: false,
      startYear: 2026,
      unitsPerYear: 0,
      purchaseYears: 0,
      allowEarlyRedemption: false,
    }
    const input: AssociationInput = {
      name: 'test',
      units: 100,
      builtYear: 2022,
      startYear: 2026,
      horizonYears: 12,
      openingBalance: 1_000_000,
      reserveSteps: [{ fromYear: 2022, monthlyPerUnit: 5_000 }],
      repairPlan: [{ year: 2032, amount: 60_000_000, label: '大規模修繕' }],
      otherCashflows: [],
      isCertified: false,
      inflationRate: 0,
    }
    const needed = requiredMonthlyIncrease(input, scenario, noBond)
    // 正の値が返る
    expect(needed).toBeGreaterThan(0)

    // needed 円/戸月を上乗せするとショートが解消する
    const boostedOk: AssociationInput = {
      ...input,
      reserveBoost: { fromYear: input.startYear, addAnnual: needed * input.units * 12 },
    }
    const resOk = simulate(boostedOk, scenario, noBond)
    expect(resOk.hasShortfall).toBe(false)

    // needed-1 円/戸月ではまだショートが残る（二分探索の精度確認）
    if (needed > 0) {
      const boostedNg: AssociationInput = {
        ...input,
        reserveBoost: { fromYear: input.startYear, addAnnual: (needed - 1) * input.units * 12 },
      }
      const resNg = simulate(boostedNg, scenario, noBond)
      expect(resNg.hasShortfall).toBe(true)
    }
  })
})

// ============================================================
// buildReportData の新フィールドのテスト
// ============================================================

describe('buildReportData 追加フィールド', () => {
  const data = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 1)

  // ---- 追加1: optimalUnits ----
  it('optimalUnits フィールドが適切な範囲の値を持つ', () => {
    expect(data.optimalUnits.optimalUnits).toBeGreaterThan(0)
    expect(data.optimalUnits.optimalBenefit).toBeGreaterThan(0)
    expect(data.optimalUnits.maxContinuousUnits).toBeGreaterThan(0)
    // maxContinuousUnits は optimalUnits 以下
    expect(data.optimalUnits.maxContinuousUnits).toBeLessThanOrEqual(data.optimalUnits.optimalUnits)
  })

  // ---- 追加2: requiredIncrease ----
  it('requiredIncrease フィールドが非負の値を持つ', () => {
    const ri = data.requiredIncrease
    expect(ri.currentInflationNoBond).toBeGreaterThanOrEqual(0)
    expect(ri.currentInflationWithBond).toBeGreaterThanOrEqual(0)
    expect(ri.stress2pctNoBond).toBeGreaterThanOrEqual(0)
    expect(ri.stress2pctWithBond).toBeGreaterThanOrEqual(0)
  })

  it('物価2%ストレスシナリオでは現行より必要引き上げ額が大きい（または同じ）', () => {
    const ri = data.requiredIncrease
    // 物価2%の方が修繕費が増えるので必要引き上げ額が大きい
    expect(ri.stress2pctNoBond).toBeGreaterThanOrEqual(ri.currentInflationNoBond)
    expect(ri.stress2pctWithBond).toBeGreaterThanOrEqual(ri.currentInflationWithBond)
  })

  it('同じ物価水準では運用ありの方が必要引き上げ額が小さい（または同じ）', () => {
    const ri = data.requiredIncrease
    expect(ri.currentInflationWithBond).toBeLessThanOrEqual(ri.currentInflationNoBond)
    expect(ri.stress2pctWithBond).toBeLessThanOrEqual(ri.stress2pctNoBond)
  })

  // ---- 追加3: perAccountMonthly ----
  it('perAccountMonthly フィールドが正の値を持つ', () => {
    const pam = data.perAccountMonthly
    expect(pam.danchi.first).toBeGreaterThan(0)
    expect(pam.danchi.last).toBeGreaterThan(0)
    expect(pam.abc.first).toBeGreaterThan(0)
    expect(pam.abc.last).toBeGreaterThan(0)
    expect(pam.de.first).toBeGreaterThan(0)
    expect(pam.de.last).toBeGreaterThan(0)
  })

  it('ABC住戸合計 = ABC棟 + 団地', () => {
    const pam = data.perAccountMonthly
    expect(pam.abcResident.first).toBe(pam.abc.first + pam.danchi.first)
    expect(pam.abcResident.last).toBe(pam.abc.last + pam.danchi.last)
  })

  it('DE住戸合計 = DE棟 + 団地', () => {
    const pam = data.perAccountMonthly
    expect(pam.deResident.first).toBe(pam.de.first + pam.danchi.first)
    expect(pam.deResident.last).toBe(pam.de.last + pam.danchi.last)
  })

  it('最終年度は初年度より月額が大きい（段階増額）', () => {
    const pam = data.perAccountMonthly
    // 段階増額で最終年度の方が高いはず
    expect(pam.danchi.last).toBeGreaterThan(pam.danchi.first)
    expect(pam.abc.last).toBeGreaterThan(pam.abc.first)
    expect(pam.de.last).toBeGreaterThan(pam.de.first)
  })

  // ---- meta.reserveBoost は未設定の場合undefined ----
  it('reserveBoost なしの場合 meta.reserveBoost は undefined', () => {
    const dataNoBoost = buildReportData(
      { ...GEO_SAITO_COMBINED, reserveBoost: undefined },
      GEO_SAITO_STRATEGY,
      1
    )
    expect(dataNoBoost.meta.reserveBoost).toBeUndefined()
  })
})

// ============================================================
// 変更1: perAccount が scenarioIdx/inflation で変わること
// ============================================================

describe('buildReportData perAccount（選択前提の連動）', () => {
  it('perAccount が3棟分返り、name・units が正しい', () => {
    const data = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 1)
    expect(data.perAccount).toHaveLength(3)
    expect(data.perAccount[0].name).toContain('団地')
    expect(data.perAccount[1].name).toContain('ABC')
    expect(data.perAccount[2].name).toContain('DE')
  })

  it('requiredIncreasePerUnitMonth が非負の値を持つ（標準シナリオ・物価0%）', () => {
    const data = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 1)
    for (const acc of data.perAccount) {
      expect(acc.requiredIncreasePerUnitMonth).toBeGreaterThanOrEqual(0)
    }
  })

  it('物価上昇率を上げると必要引き上げ額が増える（または同じ）', () => {
    const data0 = buildReportData({ ...GEO_SAITO_COMBINED, inflationRate: 0 }, GEO_SAITO_STRATEGY, 1)
    const data2 = buildReportData({ ...GEO_SAITO_COMBINED, inflationRate: 0.02 }, GEO_SAITO_STRATEGY, 1)
    for (let i = 0; i < 3; i++) {
      expect(data2.perAccount[i].requiredIncreasePerUnitMonth).toBeGreaterThanOrEqual(
        data0.perAccount[i].requiredIncreasePerUnitMonth
      )
    }
  })

  it('scenarioIdx を変えると minBalance が変わる（シナリオ連動）', () => {
    const data0 = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 0)
    const data2 = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 2)
    // 金利上昇シナリオ(2)は横ばい(0)より預金利息が多い → 最低残高が高くなる
    let anyDiff = false
    for (let i = 0; i < 3; i++) {
      if (data0.perAccount[i].minBalance.value !== data2.perAccount[i].minBalance.value) {
        anyDiff = true
      }
    }
    expect(anyDiff).toBe(true)
  })

  it('reserveBoost を設定すると棟別の requiredIncreasePerUnitMonth が減る（または同じ）', () => {
    const noBoost = buildReportData(
      { ...GEO_SAITO_COMBINED, inflationRate: 0.02, reserveBoost: undefined },
      GEO_SAITO_STRATEGY,
      1
    )
    const withBoost = buildReportData(
      {
        ...GEO_SAITO_COMBINED,
        inflationRate: 0.02,
        reserveBoost: { fromYear: 2026, addAnnual: 5000 * 372 * 12 },
      },
      GEO_SAITO_STRATEGY,
      1
    )
    for (let i = 0; i < 3; i++) {
      expect(withBoost.perAccount[i].requiredIncreasePerUnitMonth).toBeLessThanOrEqual(
        noBoost.perAccount[i].requiredIncreasePerUnitMonth
      )
    }
  })

  it('口数を増やすと棟別の requiredIncreasePerUnitMonth が減る（または同じ）', () => {
    const noUnits = buildReportData(
      { ...GEO_SAITO_COMBINED, inflationRate: 0.02 },
      { ...GEO_SAITO_STRATEGY, unitsPerYear: 0, enabled: false },
      1
    )
    const withUnits = buildReportData(
      { ...GEO_SAITO_COMBINED, inflationRate: 0.02 },
      { ...GEO_SAITO_STRATEGY, unitsPerYear: 80, enabled: true },
      1
    )
    for (let i = 0; i < 3; i++) {
      expect(withUnits.perAccount[i].requiredIncreasePerUnitMonth).toBeLessThanOrEqual(
        noUnits.perAccount[i].requiredIncreasePerUnitMonth
      )
    }
  })
})

// ============================================================
// 変更2: comparison が選択シナリオ1本で current 行を含む
// ============================================================

describe('buildReportData comparison（選択シナリオ1本）', () => {
  it('comparison は1要素の配列を返す', () => {
    const data = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 1)
    expect(data.comparison).toHaveLength(1)
  })

  it('comparison[0] のシナリオ名が選択中のシナリオに一致する（scenarioIdx=0）', () => {
    const data = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 0)
    expect(data.comparison[0].scenario).toBe(RATE_SCENARIOS[0].name)
  })

  it('comparison[0] のシナリオ名が選択中のシナリオに一致する（scenarioIdx=2）', () => {
    const data = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 2)
    expect(data.comparison[0].scenario).toBe(RATE_SCENARIOS[2].name)
  })

  it('comparison[0].rows に isCurrent=true の行が1つ以上ある', () => {
    const data = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 1)
    const currentRows = data.comparison[0].rows.filter((r) => r.isCurrent)
    expect(currentRows.length).toBeGreaterThanOrEqual(1)
  })

  it('isCurrent=true の行の unitsPerYear が strategy.unitsPerYear と一致する', () => {
    const data = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 1)
    const currentRow = data.comparison[0].rows.find((r) => r.isCurrent)
    expect(currentRow).toBeDefined()
    expect(currentRow!.unitsPerYear).toBe(GEO_SAITO_STRATEGY.unitsPerYear)
  })

  it('strategy.unitsPerYear が 80 の場合 isCurrent が 80口の標準行に付く', () => {
    const strat80 = { ...GEO_SAITO_STRATEGY, unitsPerYear: 80 }
    const data = buildReportData(GEO_SAITO_COMBINED, strat80, 1)
    const currentRow = data.comparison[0].rows.find((r) => r.isCurrent)
    expect(currentRow!.unitsPerYear).toBe(80)
    // 80口は標準行に既にあるので、rows には80口が1行のみ（重複なし）
    const rows80 = data.comparison[0].rows.filter((r) => r.unitsPerYear === 80)
    expect(rows80).toHaveLength(1)
  })

  it('strategy.unitsPerYear が非標準値(60)の場合、追加行が isCurrent=true で含まれる', () => {
    const strat60 = { ...GEO_SAITO_STRATEGY, unitsPerYear: 60 }
    const data = buildReportData(GEO_SAITO_COMBINED, strat60, 1)
    const currentRow = data.comparison[0].rows.find((r) => r.isCurrent)
    expect(currentRow).toBeDefined()
    expect(currentRow!.unitsPerYear).toBe(60)
  })

  it('comparison のシナリオが変わると行の totalInterest が変わる', () => {
    const d1 = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 0)
    const d2 = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 2)
    // 金利上昇シナリオの方が totalInterest が大きい
    const ti1 = d1.comparison[0].rows.find((r) => r.unitsPerYear === 80)?.totalInterest ?? 0
    const ti2 = d2.comparison[0].rows.find((r) => r.unitsPerYear === 80)?.totalInterest ?? 0
    expect(ti2).toBeGreaterThan(ti1)
  })
})

// ============================================================
// evaluatePlan テスト
// ============================================================

describe('evaluatePlan', () => {
  it('60口/年で妥当な結果を返す', () => {
    const result = evaluatePlan(GEO_SAITO_COMBINED, standard, 60, 10)
    expect(result.unitsPerYear).toBe(60)
    expect(result.yenPerYear).toBe(60 * 500_000)
    expect(result.cumulativePurchased).toBeGreaterThanOrEqual(0)
    expect(result.totalInterest).toBeGreaterThan(0)
    expect(result.benefit).toBeGreaterThan(0)
    expect(result.actualPurchaseYears).toBeGreaterThan(0)
    expect(result.actualPurchaseYears).toBeLessThanOrEqual(10)
  })

  it('口数=0 に相当する（極小）口数でも cumulativePurchased が 0 以上', () => {
    const result = evaluatePlan(GEO_SAITO_COMBINED, standard, 10, 10)
    expect(result.cumulativePurchased).toBeGreaterThanOrEqual(0)
  })

  it('積極案（optimalUnits）の benefit が 60 口より大きい傾向', () => {
    const optResult = findOptimalUnits(GEO_SAITO_COMBINED, standard)
    const aggressive = evaluatePlan(GEO_SAITO_COMBINED, standard, optResult.optimalUnits, 10)
    const standard60 = evaluatePlan(GEO_SAITO_COMBINED, standard, 60, 10)
    // 積極案は標準案より benefit が大きい（または同等）
    expect(aggressive.benefit).toBeGreaterThanOrEqual(standard60.benefit)
  })

  it('堅実案（maxContinuousUnits）では actualPurchaseYears = 10（全期間継続）', () => {
    const optResult = findOptimalUnits(GEO_SAITO_COMBINED, standard)
    if (optResult.maxContinuousUnits === 0) return // スキップ
    const conservative = evaluatePlan(GEO_SAITO_COMBINED, standard, optResult.maxContinuousUnits, 10)
    expect(conservative.actualPurchaseYears).toBe(10)
  })

  it('積極案の actualPurchaseYears は堅実案以下（または同等）になりうる', () => {
    const optResult = findOptimalUnits(GEO_SAITO_COMBINED, standard)
    if (optResult.maxContinuousUnits === 0 || optResult.maxContinuousUnits === optResult.optimalUnits) return
    const conservative = evaluatePlan(GEO_SAITO_COMBINED, standard, optResult.maxContinuousUnits, 10)
    const aggressive = evaluatePlan(GEO_SAITO_COMBINED, standard, optResult.optimalUnits, 10)
    // 積極案は口数が多く資金繰りがタイトなため継続年数が短くなりうる
    expect(aggressive.actualPurchaseYears).toBeLessThanOrEqual(conservative.actualPurchaseYears)
  })
})

// ============================================================
// reissue（継続運用モード）の ON/OFF 比較テスト
// ============================================================

describe('reissue（継続運用モード）の伝播', () => {
  // 標準シナリオ・物価0%・60口/年 で reissue OFF と ON を比較
  const inputZero = { ...GEO_SAITO_COMBINED, inflationRate: 0 }
  const stratOff = { ...GEO_SAITO_STRATEGY, unitsPerYear: 60, reissue: false }
  const stratOn  = { ...GEO_SAITO_STRATEGY, unitsPerYear: 60, reissue: true }

  const dataOff = buildReportData(inputZero, stratOff, 1)
  const dataOn  = buildReportData(inputZero, stratOn,  1)

  it('meta.reissue が strategy.reissue を正しく反映する', () => {
    expect(dataOff.meta.reissue).toBe(false)
    expect(dataOn.meta.reissue).toBe(true)
  })

  it('reissue=true の方が plans（各案）の benefit が大きい（または同等）', () => {
    // 継続運用モードは30年を通じて運用し続けるため、メリットが大きくなる傾向
    for (const planOn of dataOn.plans) {
      const planOff = dataOff.plans.find((p) => p.key === planOn.key)
      if (planOff) {
        expect(planOn.benefit).toBeGreaterThanOrEqual(planOff.benefit)
      }
    }
  })

  it('reissue=true の方が comparison の 80口行の benefit が大きい', () => {
    const benefitOff = dataOff.comparison[0].rows.find((r) => r.unitsPerYear === 80)?.benefit ?? 0
    const benefitOn  = dataOn.comparison[0].rows.find((r) => r.unitsPerYear === 80)?.benefit ?? 0
    expect(benefitOn).toBeGreaterThan(benefitOff)
  })

  it('reissue=true の方が findOptimalUnits の optimalBenefit が大きい（または同等）', () => {
    const resultOff = dataOff.optimalUnits
    const resultOn  = dataOn.optimalUnits
    expect(resultOn.optimalBenefit).toBeGreaterThanOrEqual(resultOff.optimalBenefit)
  })

  it('evaluatePlan(reissue=true) は evaluatePlan(reissue=false) より benefit が大きい（60口・30年標準シナリオ）', () => {
    const resultOff = evaluatePlan(inputZero, standard, 60, 10, false)
    const resultOn  = evaluatePlan(inputZero, standard, 60, 10, true)
    expect(resultOn.benefit).toBeGreaterThan(resultOff.benefit)
  })

  it('findOptimalUnits(reissue=true) は findOptimalUnits(reissue=false) より optimalBenefit が大きい（または同等）', () => {
    const resultOff = findOptimalUnits(inputZero, standard, false)
    const resultOn  = findOptimalUnits(inputZero, standard, true)
    expect(resultOn.optimalBenefit).toBeGreaterThanOrEqual(resultOff.optimalBenefit)
  })
})

// ============================================================
// buildReportData の plans フィールドのテスト
// ============================================================

describe('buildReportData plans（3案比較）', () => {
  const data = buildReportData(GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, 1)

  it('plans が1〜3案を持つ（重複排除で最低1案）', () => {
    expect(data.plans.length).toBeGreaterThanOrEqual(1)
    expect(data.plans.length).toBeLessThanOrEqual(3)
  })

  it('各案が必要なフィールドを持つ', () => {
    for (const plan of data.plans) {
      expect(typeof plan.key).toBe('string')
      expect(typeof plan.name).toBe('string')
      expect(typeof plan.purpose).toBe('string')
      expect(plan.unitsPerYear).toBeGreaterThan(0)
      expect(plan.yenPerYear).toBe(plan.unitsPerYear * 500_000)
      expect(plan.cumulativePurchased).toBeGreaterThanOrEqual(0)
      expect(plan.totalInterest).toBeGreaterThanOrEqual(0)
      expect(plan.actualPurchaseYears).toBeGreaterThanOrEqual(0)
      expect(plan.actualPurchaseYears).toBeLessThanOrEqual(10)
    }
  })

  it('benefit が非負（標準シナリオ・物価0%では各案ともプラス）', () => {
    const dataZero = buildReportData({ ...GEO_SAITO_COMBINED, inflationRate: 0 }, GEO_SAITO_STRATEGY, 1)
    for (const plan of dataZero.plans) {
      expect(plan.benefit).toBeGreaterThanOrEqual(0)
    }
  })

  it('口数が昇順にソートされている', () => {
    const units = data.plans.map((p) => p.unitsPerYear)
    for (let i = 1; i < units.length; i++) {
      expect(units[i]).toBeGreaterThanOrEqual(units[i - 1])
    }
  })

  it('積極案 benefit >= 堅実案 benefit（メリット最大口数の定義より）', () => {
    const aggressive = data.plans.find((p) => p.key === 'aggressive')
    const conservative = data.plans.find((p) => p.key === 'conservative')
    // 積極案が存在する場合のみ（重複排除で消えることもある）
    if (aggressive && conservative) {
      expect(aggressive.benefit).toBeGreaterThanOrEqual(conservative.benefit)
    }
  })

  it('堅実案（conservative）の unitsPerYear は 10 以上', () => {
    const conservative = data.plans.find((p) => p.key === 'conservative')
    if (conservative) {
      expect(conservative.unitsPerYear).toBeGreaterThanOrEqual(10)
    }
  })

  it('堅実案（conservative）が maxContinuousUnits > 0 の場合は actualPurchaseYears = 10', () => {
    const optResult = findOptimalUnits(GEO_SAITO_COMBINED, standard)
    if (optResult.maxContinuousUnits > 0) {
      const conservative = data.plans.find((p) => p.key === 'conservative')
      if (conservative) {
        expect(conservative.actualPurchaseYears).toBe(10)
      }
    }
  })

  it('物価2%シナリオでも plans が返る', () => {
    const data2 = buildReportData({ ...GEO_SAITO_COMBINED, inflationRate: 0.02 }, GEO_SAITO_STRATEGY, 1)
    expect(data2.plans.length).toBeGreaterThanOrEqual(1)
  })
})
