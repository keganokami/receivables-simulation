import { describe, it, expect } from 'vitest'
import {
  applyCostReductions,
  applyCostReductionsWithDetail,
  DEFAULT_COST_REDUCTION_OPTIONS,
  CostReductionOptions,
} from './costReduction'
import { AssociationInput } from './types'

function baseInput(overrides: Partial<AssociationInput> = {}): AssociationInput {
  return {
    name: 'test',
    units: 100,
    builtYear: 2022,
    startYear: 2026,
    horizonYears: 30, // 2026〜2055
    openingBalance: 0,
    reserveSteps: [{ fromYear: 2022, monthlyPerUnit: 10_000 }],
    repairPlan: [
      { year: 2034, amount: 293_304_000, label: 'ABC: 第1回 大規模修繕' },
      { year: 2046, amount: 327_939_000, label: 'ABC: 第2回 大規模修繕' },
      { year: 2035, amount: 268_807_000, label: 'DE: 第1回 大規模修繕' },
      { year: 2047, amount: 293_667_000, label: 'DE: 第2回 大規模修繕' },
      { year: 2052, amount: 445_280_000, label: '団地: 機械式駐車場 全取替ほか(2052年度)' },
      { year: 2028, amount: 8_782_000, label: '団地: 計画修繕' },
    ],
    otherCashflows: [],
    isCertified: false,
    inflationRate: 0,
    ...overrides,
  }
}

function opts(overrides: Partial<CostReductionOptions> = {}): CostReductionOptions {
  return {
    cycleExtension: { ...DEFAULT_COST_REDUCTION_OPTIONS.cycleExtension },
    unifyBuildings: { ...DEFAULT_COST_REDUCTION_OPTIONS.unifyBuildings },
    designSupervision: { ...DEFAULT_COST_REDUCTION_OPTIONS.designSupervision },
    parkingReduction: { ...DEFAULT_COST_REDUCTION_OPTIONS.parkingReduction },
    scopeOptimization: { ...DEFAULT_COST_REDUCTION_OPTIONS.scopeOptimization },
    ...overrides,
  }
}

describe('applyCostReductions: 何もしない場合', () => {
  it('全レバーOFFなら repairPlan は変化しない（値のみ・参照は複製）', () => {
    const input = baseInput()
    const result = applyCostReductions(input, opts())
    expect(result.repairPlan).toEqual(input.repairPlan)
    expect(result.repairPlan).not.toBe(input.repairPlan)
  })

  it('元の input を変更しない（イミュータブル）', () => {
    const input = baseInput()
    const before = JSON.parse(JSON.stringify(input))
    applyCostReductions(
      input,
      opts({
        cycleExtension: { enabled: true, newCycle: 15 },
        unifyBuildings: { enabled: true, savingRate: 0.05 },
        designSupervision: { enabled: true, savingRate: 0.1, consultantFeeRate: 0.05 },
        parkingReduction: { enabled: true, reductionRate: 0.5 },
        scopeOptimization: { enabled: true, reductionRate: 0.03 },
      })
    )
    expect(input).toEqual(before)
  })
})

describe('cycleExtension: 修繕周期の延長', () => {
  it('newCycle=15 なら 1回目は+3年、2回目は+6年 後ろ倒しされる', () => {
    const input = baseInput()
    const result = applyCostReductions(input, opts({ cycleExtension: { enabled: true, newCycle: 15 } }))
    const abc1 = result.repairPlan.find((r) => r.label === 'ABC: 第1回 大規模修繕')!
    const abc2 = result.repairPlan.find((r) => r.label === 'ABC: 第2回 大規模修繕')!
    expect(abc1.year).toBe(2034 + 3) // 1回目(idx0): +1×3
    expect(abc2.year).toBe(2046 + 6) // 2回目(idx1): +2×3
  })

  it('後ろ倒しの結果が試算期間を超えると計画期間外として除外される', () => {
    // horizonYears=30 → endYear=2055。newCycle=18(delta=6) だと2回目(2046+12=2058)が期間外。
    const input = baseInput()
    const result = applyCostReductions(input, opts({ cycleExtension: { enabled: true, newCycle: 18 } }))
    const abc2 = result.repairPlan.find((r) => r.label === 'ABC: 第2回 大規模修繕')
    expect(abc2).toBeUndefined()
    // 1回目(2034+6=2040)は期間内なので残る
    const abc1 = result.repairPlan.find((r) => r.label === 'ABC: 第1回 大規模修繕')
    expect(abc1?.year).toBe(2040)
  })

  it('大規模修繕以外の項目は年・金額とも変化しない', () => {
    const input = baseInput()
    const result = applyCostReductions(input, opts({ cycleExtension: { enabled: true, newCycle: 15 } }))
    const keikaku = result.repairPlan.find((r) => r.label === '団地: 計画修繕')!
    expect(keikaku.year).toBe(2028)
    expect(keikaku.amount).toBe(8_782_000)
  })

  it('newCycle=12（現行のまま）なら年は変化しない', () => {
    const input = baseInput()
    const result = applyCostReductions(input, opts({ cycleExtension: { enabled: true, newCycle: 12 } }))
    expect(result.repairPlan.find((r) => r.label === 'ABC: 第1回 大規模修繕')!.year).toBe(2034)
    expect(result.repairPlan.find((r) => r.label === 'ABC: 第2回 大規模修繕')!.year).toBe(2046)
  })
})

describe('applyCostReductionsWithDetail: 期間外への繰り延べの分離', () => {
  it('周期18年では2件（ABC第2回・DE第2回）が期間外へ繰り延べられ、合計は約6.22億円', () => {
    const input = baseInput()
    const { input: result, deferredOutOfHorizon } = applyCostReductionsWithDetail(
      input,
      opts({ cycleExtension: { enabled: true, newCycle: 18 } })
    )
    expect(deferredOutOfHorizon.items).toHaveLength(2)
    expect(deferredOutOfHorizon.items.map((i) => i.label).sort()).toEqual(
      ['ABC: 第2回 大規模修繕', 'DE: 第2回 大規模修繕'].sort()
    )
    expect(deferredOutOfHorizon.totalAmount).toBeCloseTo(327_939_000 + 293_667_000)
    expect(deferredOutOfHorizon.totalAmount / 1e8).toBeCloseTo(6.22, 1)
    // 除外された工事は repairPlan からも消えている
    expect(result.repairPlan.find((r) => r.label === 'ABC: 第2回 大規模修繕')).toBeUndefined()
  })

  it('周期12年（現行のまま）では繰り延べは0件・0円', () => {
    const input = baseInput()
    const { deferredOutOfHorizon } = applyCostReductionsWithDetail(
      input,
      opts({ cycleExtension: { enabled: true, newCycle: 12 } })
    )
    expect(deferredOutOfHorizon.items).toHaveLength(0)
    expect(deferredOutOfHorizon.totalAmount).toBe(0)
  })

  it('cycleExtension が無効なら繰り延べは0件・0円', () => {
    const input = baseInput()
    const { deferredOutOfHorizon } = applyCostReductionsWithDetail(input, opts())
    expect(deferredOutOfHorizon.items).toHaveLength(0)
    expect(deferredOutOfHorizon.totalAmount).toBe(0)
  })

  it('applyCostReductions（互換API）は .input と同じ repairPlan を返す', () => {
    const input = baseInput()
    const o = opts({ cycleExtension: { enabled: true, newCycle: 18 } })
    const compat = applyCostReductions(input, o)
    const detailed = applyCostReductionsWithDetail(input, o)
    expect(compat).toEqual(detailed.input)
  })
})

describe('unifyBuildings: 棟の一括発注', () => {
  it('ABC棟の大規模修繕をDE棟(同じ回次)の年へ移動し、両者に削減率を適用する', () => {
    const input = baseInput()
    const result = applyCostReductions(input, opts({ unifyBuildings: { enabled: true, savingRate: 0.05 } }))
    const abc1 = result.repairPlan.find((r) => r.label === 'ABC: 第1回 大規模修繕')!
    const de1 = result.repairPlan.find((r) => r.label === 'DE: 第1回 大規模修繕')!
    expect(abc1.year).toBe(2035) // DE 第1回の年へ統合
    expect(abc1.amount).toBeCloseTo(293_304_000 * 0.95)
    expect(de1.amount).toBeCloseTo(268_807_000 * 0.95)

    const abc2 = result.repairPlan.find((r) => r.label === 'ABC: 第2回 大規模修繕')!
    const de2 = result.repairPlan.find((r) => r.label === 'DE: 第2回 大規模修繕')!
    expect(abc2.year).toBe(2047)
    expect(abc2.amount).toBeCloseTo(327_939_000 * 0.95)
    expect(de2.amount).toBeCloseTo(293_667_000 * 0.95)
  })

  it('団地会計・機械式駐車場など無関係の項目には影響しない', () => {
    const input = baseInput()
    const result = applyCostReductions(input, opts({ unifyBuildings: { enabled: true, savingRate: 0.05 } }))
    const parking = result.repairPlan.find((r) => r.label.includes('機械式駐車場'))!
    expect(parking.amount).toBe(445_280_000)
  })
})

describe('designSupervision: 設計監理方式', () => {
  it('大規模修繕に savingRate の削減を適用した後 consultantFeeRate を加算する', () => {
    const input = baseInput()
    const result = applyCostReductions(
      input,
      opts({ designSupervision: { enabled: true, savingRate: 0.1, consultantFeeRate: 0.05 } })
    )
    const abc1 = result.repairPlan.find((r) => r.label === 'ABC: 第1回 大規模修繕')!
    // 実質 -5%（10%削減 - 5%コンサル費）
    expect(abc1.amount).toBeCloseTo(293_304_000 * 0.95)
  })

  it('大規模修繕以外（機械式駐車場・計画修繕）には適用されない', () => {
    const input = baseInput()
    const result = applyCostReductions(
      input,
      opts({ designSupervision: { enabled: true, savingRate: 0.1, consultantFeeRate: 0.05 } })
    )
    expect(result.repairPlan.find((r) => r.label === '団地: 計画修繕')!.amount).toBe(8_782_000)
    expect(result.repairPlan.find((r) => r.label.includes('機械式駐車場'))!.amount).toBe(445_280_000)
  })
})

describe('parkingReduction: 機械式駐車場の見直し', () => {
  it('機械式駐車場の項目に reductionRate の削減を適用する', () => {
    const input = baseInput()
    const result = applyCostReductions(input, opts({ parkingReduction: { enabled: true, reductionRate: 0.5 } }))
    const parking = result.repairPlan.find((r) => r.label.includes('機械式駐車場'))!
    expect(parking.amount).toBeCloseTo(445_280_000 * 0.5)
  })

  it('大規模修繕には適用されない', () => {
    const input = baseInput()
    const result = applyCostReductions(input, opts({ parkingReduction: { enabled: true, reductionRate: 0.5 } }))
    expect(result.repairPlan.find((r) => r.label === 'ABC: 第1回 大規模修繕')!.amount).toBe(293_304_000)
  })
})

describe('scopeOptimization: 仕様・数量の精査', () => {
  it('大規模修繕に reductionRate の削減を適用する', () => {
    const input = baseInput()
    const result = applyCostReductions(input, opts({ scopeOptimization: { enabled: true, reductionRate: 0.03 } }))
    const abc1 = result.repairPlan.find((r) => r.label === 'ABC: 第1回 大規模修繕')!
    expect(abc1.amount).toBeCloseTo(293_304_000 * 0.97)
  })
})

describe('複数レバーの組み合わせ', () => {
  it('cycleExtension → unifyBuildings → designSupervision → parkingReduction → scopeOptimization の順に適用される', () => {
    const input = baseInput()
    const result = applyCostReductions(
      input,
      opts({
        cycleExtension: { enabled: true, newCycle: 15 },
        unifyBuildings: { enabled: true, savingRate: 0.05 },
        designSupervision: { enabled: true, savingRate: 0.1, consultantFeeRate: 0.05 },
        scopeOptimization: { enabled: true, reductionRate: 0.03 },
      })
    )
    // ABC第1回: 2034+3=2037 → unifyでDE第1回(2035+3=2038)の年に統合 → 各種削減を multiplicative に適用
    const de1 = result.repairPlan.find((r) => r.label === 'DE: 第1回 大規模修繕')!
    const abc1 = result.repairPlan.find((r) => r.label === 'ABC: 第1回 大規模修繕')!
    expect(abc1.year).toBe(de1.year)
    expect(abc1.year).toBe(2038) // DE第1回: 2035 + 1×3
    const expectedFactor = 0.95 * 0.95 * 0.97 // unify × designSupervision(1-0.1+0.05=0.95) × scope
    expect(abc1.amount).toBeCloseTo(293_304_000 * expectedFactor)
  })
})
