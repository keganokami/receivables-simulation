import { AssociationInput, RepairItem } from './types'

// ============================================================================
// 修繕費の削減シミュレーション
//
// 「修繕費そのものを抑える一般的な手法」を長期修繕計画（repairPlan）に適用し、
// 変換した新しい AssociationInput を返す。既存の simulate / requiredMonthlyIncrease を
// そのまま再利用できるよう、計算ロジックには一切手を入れない（イミュータブル）。
//
// 重要（正直な注記）：ここでの削減率はすべて「利用者が置く仮定値」。
// 手法ごとの削減率について公的な統計・実績値は公表されていない。
// 実際の削減額は建物診断・見積り・発注方式で大きく変わる。
// ============================================================================

export interface CostReductionOptions {
  /** 修繕周期の延長（12年→N年）。大規模修繕の実施年を後ろ倒しし、計画期間内の回数を減らす */
  cycleExtension: { enabled: boolean; newCycle: number } // 12 | 13 | 15 | 18
  /** 棟の一括発注（ABC棟の大規模修繕をDE棟の年に統合）。共通仮設・設計監理の重複削減 */
  unifyBuildings: { enabled: boolean; savingRate: number } // 既定 0.05
  /** 設計監理方式（相見積りによる削減 − コンサル費） */
  designSupervision: { enabled: boolean; savingRate: number; consultantFeeRate: number } // 既定 0.10 / 0.05
  /** 機械式駐車場の見直し（平面化・台数削減） */
  parkingReduction: { enabled: boolean; reductionRate: number } // 既定 0.5
  /** 仕様・数量の精査（劣化診断に基づく） */
  scopeOptimization: { enabled: boolean; reductionRate: number } // 既定 0.03
}

/** 各レバーの既定値（OFF・既定の率）。ページの初期状態やレバー単独試算のベースに使う。 */
export const DEFAULT_COST_REDUCTION_OPTIONS: CostReductionOptions = {
  cycleExtension: { enabled: false, newCycle: 12 },
  unifyBuildings: { enabled: false, savingRate: 0.05 },
  designSupervision: { enabled: false, savingRate: 0.1, consultantFeeRate: 0.05 },
  parkingReduction: { enabled: false, reductionRate: 0.5 },
  scopeOptimization: { enabled: false, reductionRate: 0.03 },
}

type Building = 'ABC' | 'DE' | '団地' | null

/** label の先頭から棟を判別する（'ABC: ...' / 'DE: ...' / '団地: ...'） */
function buildingOf(label: string): Building {
  if (label.startsWith('ABC')) return 'ABC'
  if (label.startsWith('DE')) return 'DE'
  if (label.startsWith('団地')) return '団地'
  return null
}

/** label に「大規模修繕」を含むか（対象工事の判定） */
export function isMajorRepairLabel(label: string): boolean {
  return label.includes('大規模修繕')
}

/** label に「機械式駐車場」を含むか */
export function isParkingLabel(label: string): boolean {
  return label.includes('機械式駐車場')
}

/** 期間外へ繰り延べられた工事の集計 */
export interface DeferredOutOfHorizon {
  /** 繰り延べられた工事の合計額（除外時点＝後ろ倒し後の年・基準年価格の金額） */
  totalAmount: number
  /** 繰り延べられた工事の一覧（除外時点の年・金額） */
  items: RepairItem[]
}

export interface CostReductionResult {
  input: AssociationInput
  /**
   * 修繕周期の延長により試算期間の外に押し出された工事。
   * 注意：これは「工事費が削減された」のではなく、支出が期間外に移動しただけ。
   */
  deferredOutOfHorizon: DeferredOutOfHorizon
}

/**
 * repairPlan にコスト削減レバーを適用し、変換した新しい AssociationInput と、
 * 修繕周期の延長によって試算期間外へ繰り延べられた工事の内訳を返す。
 * 元の input は変更しない。
 */
export function applyCostReductionsWithDetail(
  input: AssociationInput,
  opts: CostReductionOptions
): CostReductionResult {
  const endYear = input.startYear + input.horizonYears - 1
  let items: RepairItem[] = input.repairPlan.map((r) => ({ ...r }))
  const deferredItems: RepairItem[] = []

  // 1. 修繕周期の延長: 棟ごとに大規模修繕を年順に並べ、n回目(0始まり)を
  //    (n+1) × (newCycle-12) 年だけ後ろ倒し。試算期間を超えたら計画期間外（繰り延べ）として除外。
  if (opts.cycleExtension.enabled) {
    const delta = opts.cycleExtension.newCycle - 12
    if (delta !== 0) {
      const byBuilding = new Map<Building, RepairItem[]>()
      for (const item of items) {
        if (!isMajorRepairLabel(item.label)) continue
        const b = buildingOf(item.label)
        if (!byBuilding.has(b)) byBuilding.set(b, [])
        byBuilding.get(b)!.push(item)
      }
      for (const group of byBuilding.values()) {
        group.sort((a, b) => a.year - b.year)
        group.forEach((item, idx) => {
          item.year = item.year + (idx + 1) * delta
        })
      }
    }
    for (const item of items) {
      if (isMajorRepairLabel(item.label) && item.year > endYear) {
        deferredItems.push({ ...item })
      }
    }
    items = items.filter((item) => !isMajorRepairLabel(item.label) || item.year <= endYear)
  }

  // 2. 棟の一括発注: ABC棟の大規模修繕を、同じ回次のDE棟大規模修繕と同じ年へ移動。
  //    移動して同一年に集まった大規模修繕の合計に savingRate の削減を適用。
  if (opts.unifyBuildings.enabled) {
    const abcItems = items
      .filter((i) => isMajorRepairLabel(i.label) && buildingOf(i.label) === 'ABC')
      .sort((a, b) => a.year - b.year)
    const deItems = items
      .filter((i) => isMajorRepairLabel(i.label) && buildingOf(i.label) === 'DE')
      .sort((a, b) => a.year - b.year)
    const n = Math.min(abcItems.length, deItems.length)
    const factor = 1 - opts.unifyBuildings.savingRate
    for (let i = 0; i < n; i++) {
      const abc = abcItems[i]
      const de = deItems[i]
      abc.year = de.year // DE棟の年へ統合（DE棟が後ろの年になるのが通常）
      abc.amount = abc.amount * factor
      de.amount = de.amount * factor
    }
  }

  // 3. 設計監理方式: 大規模修繕に savingRate の削減を適用した後、consultantFeeRate を加算。
  if (opts.designSupervision.enabled) {
    const factor = 1 - opts.designSupervision.savingRate + opts.designSupervision.consultantFeeRate
    for (const item of items) {
      if (isMajorRepairLabel(item.label)) item.amount = item.amount * factor
    }
  }

  // 4. 機械式駐車場の見直し
  if (opts.parkingReduction.enabled) {
    const factor = 1 - opts.parkingReduction.reductionRate
    for (const item of items) {
      if (isParkingLabel(item.label)) item.amount = item.amount * factor
    }
  }

  // 5. 仕様・数量の精査
  if (opts.scopeOptimization.enabled) {
    const factor = 1 - opts.scopeOptimization.reductionRate
    for (const item of items) {
      if (isMajorRepairLabel(item.label)) item.amount = item.amount * factor
    }
  }

  return {
    input: { ...input, repairPlan: items },
    deferredOutOfHorizon: {
      totalAmount: deferredItems.reduce((s, i) => s + i.amount, 0),
      items: deferredItems,
    },
  }
}

/**
 * repairPlan にコスト削減レバーを適用し、変換した新しい AssociationInput を返す（互換API）。
 * 期間外へ繰り延べられた工事の内訳が必要な場合は applyCostReductionsWithDetail を使う。
 */
export function applyCostReductions(
  input: AssociationInput,
  opts: CostReductionOptions
): AssociationInput {
  return applyCostReductionsWithDetail(input, opts).input
}
