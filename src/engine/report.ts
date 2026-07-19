import { simulate, simulateWithoutBond } from './simulate'
import { RATE_SCENARIOS } from './scenarios'
import { ACCOUNTS, accountInput } from './geoSaito'
import { AssociationInput, BondStrategy, BOND_UNIT_YEN, RateScenario, SimulationResult } from './types'

// geoSaito.ts の annualOf と同じロジックをここでも使う
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

// ============================================================================
// レポート用データの算出（アプリ・レポートスクリプトで共通利用）
// 数値はすべてエンジンで確定させる。所見（最新利率の解説等）はレポート側でClaudeが付与。
// ============================================================================

function minBalance(res: SimulationResult): { value: number; year: number } {
  return res.rows.reduce(
    (m, r) => (r.totalEnd < m.value ? { value: r.totalEnd, year: r.year } : m),
    { value: Infinity, year: 0 }
  )
}

function mkStrategy(units: number, years = 10, reissue = false): BondStrategy {
  return {
    enabled: true,
    startYear: 2026,
    unitsPerYear: units,
    purchaseYears: years,
    allowEarlyRedemption: true,
    reissue,
  }
}

// ============================================================================
// evaluatePlan
// ============================================================================

export interface PlanEvalResult {
  key: string
  name: string
  /** 1行説明 */
  purpose: string
  unitsPerYear: number
  yenPerYear: number
  /** bondPurchase > 0 の年数（実際に継続できた年数） */
  actualPurchaseYears: number
  /** 最後に購入した年（購入がなければ null） */
  lastPurchaseYear: number | null
  cumulativePurchased: number
  totalInterest: number
  /** 対「運用なし」の期末総資産差 */
  benefit: number
  minBalance: { value: number; year: number }
  shortfallYear: number | null
}

export function evaluatePlan(
  input: AssociationInput,
  scenario: RateScenario,
  unitsPerYear: number,
  purchaseYears = 10,
  reissue = false
): Omit<PlanEvalResult, 'key' | 'name' | 'purpose'> {
  const baseline = simulateWithoutBond(input, scenario)
  const res = simulate(input, scenario, {
    enabled: true,
    startYear: input.startYear,
    unitsPerYear,
    purchaseYears,
    allowEarlyRedemption: true,
    reissue,
  })

  // bondPurchase > 0 の年を集める
  const purchaseRows = res.rows.filter((r) => r.bondPurchase > 0)
  const actualPurchaseYears = purchaseRows.length
  const lastPurchaseYear = purchaseRows.length > 0 ? purchaseRows[purchaseRows.length - 1].year : null
  const cumulativePurchased = purchaseRows.reduce((s, r) => s + r.bondPurchase, 0)

  const mb = minBalance(res)

  return {
    unitsPerYear,
    yenPerYear: unitsPerYear * BOND_UNIT_YEN,
    actualPurchaseYears,
    lastPurchaseYear,
    cumulativePurchased,
    totalInterest: res.totalInterest,
    benefit: res.endingTotal - baseline.endingTotal,
    minBalance: mb,
    shortfallYear: res.firstShortfallYear,
  }
}

export interface ReportData {
  meta: {
    name: string
    units: number
    openingBalance: number
    startYear: number
    endYear: number
    scenarioName: string
    inflationRate: number
    /** アプリで現在選択中の すまい・る債 口数/年（0=運用なし） */
    currentUnitsPerYear: number
    /** 継続運用モード（満期後も新規発行を継続するか） */
    reissue: boolean
    /** 修繕費の物価上昇率の基準年（長期修繕計画の単価時点） */
    priceBaseYear: number
    /** 管理計画認定マンションか */
    isCertified: boolean
    /** すまい・る債の継続購入年数の設定（最大10） */
    purchaseYears: number
    /** 資金不足時に中途換金して充当するか */
    allowEarlyRedemption: boolean
    /** すまい・る債の購入開始年度 */
    bondStartYear: number
    /** 開始年度のすまい・る債利率(%) */
    bondRateStart: number
    /** 預金利率(%) */
    depositRate: number
    /** 利率シナリオの説明 */
    scenarioDescription: string
    /** reserveBoost が設定されている場合の情報 */
    reserveBoost?: {
      fromYear: number
      perUnitMonth: number
      totalExtra: number
    }
  }
  /** 大規模修繕など大型支出（しきい値以上） */
  bigWorks: { year: number; amount: number; label: string }[]
  /**
   * 棟別の資金見通し（選択中のシナリオ・物価上昇率・口数按分で再計算）
   * combined の前提（inflationRate・reserveBoost・strategy の口数）を各棟に按分して適用。
   * 原典3会計データ(geoSaito)から算出しており、combined 値の手編集は反映されません。
   */
  perAccount: {
    name: string
    units: number
    openingBalance: number
    endingTotal: number
    minBalance: { value: number; year: number }
    shortfallYear: number | null
    /** 棟別の必要引き上げ額（円/戸月）。選択中のシナリオ・物価・口数按分を反映 */
    requiredIncreasePerUnitMonth: number
  }[]
  /**
   * すまい・る債 戦略の比較（選択中のシナリオ1本 × 口数）
   * 選択シナリオを基準に運用なし/40/80/120口 + 現在の口数を比較。
   */
  comparison: {
    scenario: string
    depositRate: number
    bondRateStart: number
    rows: {
      label: string
      unitsPerYear: number
      totalInterest: number
      benefit: number
      minBalance: { value: number; year: number }
      shortfallYear: number | null
      /** 現在アプリで選択中の口数の行かどうか */
      isCurrent: boolean
    }[]
  }[]
  /** 推奨戦略での合算総資産の推移（グラフ用） */
  balanceSeries: { year: number; withBond: number; withoutBond: number; expense: number }[]
  recommendation: {
    unitsPerYear: number
    yenPerYear: number
    firstPurchaseYen: number
    reason: string[]
  }
  /**
   * すまい・る債 運用プラン比較（3案）
   * 堅実案・標準案・積極案。口数が重複する場合は重複排除済み。
   */
  plans: PlanEvalResult[]
  /**
   * 追加1: 最適口数の自動試算結果
   */
  optimalUnits: {
    optimalUnits: number
    optimalBenefit: number
    maxContinuousUnits: number
  }
  /**
   * 追加2: 資金ショート解消に必要な戸あたり月額引き上げ
   * 物価0% / 物価2% × 運用なし / 運用あり の4パターン
   */
  requiredIncrease: {
    /** 現行物価上昇率（inflationRate）× 運用なし */
    currentInflationNoBond: number
    /** 現行物価上昇率（inflationRate）× 運用あり */
    currentInflationWithBond: number
    /** 物価2%（stress）× 運用なし */
    stress2pctNoBond: number
    /** 物価2%（stress）× 運用あり */
    stress2pctWithBond: number
  }
  /**
   * 追加3: 棟別の毎月の修繕積立金（戸あたり平均）
   */
  perAccountMonthly: {
    /** 団地会計の初年度・最終年度の戸あたり月額 */
    danchi: { first: number; last: number }
    /** ABC棟会計の初年度・最終年度の戸あたり月額 */
    abc: { first: number; last: number }
    /** DE棟会計の初年度・最終年度の戸あたり月額 */
    de: { first: number; last: number }
    /** ABC住戸合計（ABC棟+団地）の初年度・最終年度 */
    abcResident: { first: number; last: number }
    /** DE住戸合計（DE棟+団地）の初年度・最終年度 */
    deResident: { first: number; last: number }
  }
  /**
   * 追加4: 資金ショート解消マトリクス（積立引き上げ × すまい・る債の有無）
   */
  shortfallMatrix: ShortfallMatrixResult
}

const BIG_WORK_THRESHOLD = 50_000_000

export function buildReportData(
  input: AssociationInput,
  strategy: BondStrategy,
  scenarioIdx: number
): ReportData {
  const scenario = RATE_SCENARIOS[scenarioIdx] ?? RATE_SCENARIOS[1]
  const endYear = input.startYear + input.horizonYears - 1

  // 大型支出（物価調整前の計画額）
  const bigWorks = input.repairPlan
    .filter((r) => r.amount >= BIG_WORK_THRESHOLD)
    .sort((a, b) => a.year - b.year)
    .map((r) => ({ year: r.year, amount: r.amount, label: r.label }))

  // 棟別（選択シナリオ・物価上昇率・reserveBoost・口数按分を反映）
  // ※ 原典3会計データ(geoSaito)から算出。combined の手編集は棟別には反映されません。
  const perAccount = ACCOUNTS.map((a) => {
    // combined の inflationRate/priceBaseYear を棟別に伝播
    const baseInp: AssociationInput = {
      ...accountInput(a),
      inflationRate: input.inflationRate,
      priceBaseYear: input.priceBaseYear,
    }

    // combined の reserveBoost を戸数按分して棟別に適用
    const accInp: AssociationInput = (() => {
      if (input.reserveBoost && input.reserveBoost.addAnnual > 0) {
        const perUnitMonthAmt = input.reserveBoost.addAnnual / input.units / 12
        const accAddAnnual = Math.round(perUnitMonthAmt * a.units * 12)
        return {
          ...baseInp,
          reserveBoost: {
            fromYear: input.reserveBoost.fromYear,
            addAnnual: accAddAnnual,
          },
        }
      }
      return baseInp
    })()

    // combined の unitsPerYear を戸数按分して棟別の戦略を生成
    const accUnitsPerYear = strategy.enabled && strategy.unitsPerYear > 0
      ? Math.max(0, Math.round(strategy.unitsPerYear * a.units / input.units))
      : 0
    const accStrategy: BondStrategy = accUnitsPerYear > 0
      ? {
          ...strategy,
          unitsPerYear: accUnitsPerYear,
        }
      : {
          enabled: false,
          startYear: strategy.startYear,
          unitsPerYear: 0,
          purchaseYears: 0,
          allowEarlyRedemption: false,
        }

    const res = simulate(accInp, scenario, accStrategy)
    const reqIncrease = requiredMonthlyIncrease(accInp, scenario, accStrategy)

    return {
      name: a.name,
      units: a.units,
      openingBalance: a.openingBalance,
      endingTotal: res.endingTotal,
      minBalance: minBalance(res),
      shortfallYear: res.firstShortfallYear,
      requiredIncreasePerUnitMonth: reqIncrease,
    }
  })

  // 戦略比較（選択シナリオ1本 × 口数）
  // 運用なし/40/80/120口 の基準4本 + 現在の口数（isCurrent=true）
  const currentUnitsPerYear = strategy.enabled ? strategy.unitsPerYear : 0
  const baseVariants: { label: string; units: number; years: number }[] = [
    { label: '運用なし', units: 0, years: 0 },
    { label: '40口/年（年2,000万円）', units: 40, years: 10 },
    { label: '80口/年（年4,000万円）', units: 80, years: 10 },
    { label: '120口/年（年6,000万円）', units: 120, years: 10 },
  ]
  // 現在の口数が既存の基準行と重複しない場合のみ追加
  const standardUnits = new Set([0, 40, 80, 120])
  const allVariants: { label: string; units: number; years: number; isCurrent: boolean }[] = [
    ...baseVariants.map((v) => ({ ...v, isCurrent: v.units === currentUnitsPerYear })),
  ]
  if (!standardUnits.has(currentUnitsPerYear)) {
    allVariants.push({
      label: `${currentUnitsPerYear}口/年（現在の設定）`,
      units: currentUnitsPerYear,
      years: strategy.purchaseYears ?? 10,
      isCurrent: true,
    })
    // 口数順にソート
    allVariants.sort((a, b) => a.units - b.units)
  }

  const reissue = strategy.reissue ?? false
  const compBase = simulateWithoutBond(input, scenario)
  const comparison = [
    {
      scenario: scenario.name,
      depositRate: scenario.depositRate,
      bondRateStart: scenario.bondRatesByYear[input.startYear] ?? 0,
      rows: allVariants.map((v) => {
        const res = v.units === 0 ? compBase : simulate(input, scenario, mkStrategy(v.units, v.years, reissue))
        return {
          label: v.label,
          unitsPerYear: v.units,
          totalInterest: res.totalInterest,
          benefit: res.endingTotal - compBase.endingTotal,
          minBalance: minBalance(res),
          shortfallYear: res.firstShortfallYear,
          isCurrent: v.isCurrent,
        }
      }),
    },
  ]

  // 選択シナリオ・戦略での推移
  const withB = simulate(input, scenario, strategy)
  const without = simulateWithoutBond(input, scenario)
  const balanceSeries = withB.rows.map((r, i) => ({
    year: r.year,
    withBond: r.totalEnd,
    withoutBond: without.rows[i]?.totalEnd ?? 0,
    expense: r.repairExpense,
  }))

  // ---- プラン比較（3案） ----
  // findOptimalUnits の結果を先取りして定義する（buildReportData 内で利用）
  const optimalUnitsForPlans = findOptimalUnits(input, scenario, reissue)
  const STANDARD_UNITS = 60
  const planDefs: { key: string; name: string; purpose: string; units: number }[] = []
  // 口数の重複排除（堅実 → 標準 → 積極 の優先度で）
  const usedUnits = new Set<number>()
  // 堅実案: maxContinuousUnits=0 の場合（物価高ストレスシナリオ等）は最小10口をフロアとして使う
  const kensitsuUnits = Math.max(10, optimalUnitsForPlans.maxContinuousUnits)
  planDefs.push({
    key: 'conservative',
    name: '堅実案',
    purpose: '無理なく10年継続・中途換金なし',
    units: kensitsuUnits,
  })
  usedUnits.add(kensitsuUnits)
  // 標準案
  if (!usedUnits.has(STANDARD_UNITS)) {
    planDefs.push({
      key: 'standard',
      name: '標準案',
      purpose: 'バランス',
      units: STANDARD_UNITS,
    })
    usedUnits.add(STANDARD_UNITS)
  }
  // 積極案
  const sekkyokuUnits = optimalUnitsForPlans.optimalUnits
  if (!usedUnits.has(sekkyokuUnits)) {
    planDefs.push({
      key: 'aggressive',
      name: '積極案',
      purpose: 'メリット最大・中途換金前提',
      units: sekkyokuUnits,
    })
    usedUnits.add(sekkyokuUnits)
  }
  // 口数昇順にソート
  planDefs.sort((a, b) => a.units - b.units)
  // 積極案が planDefs に入っていなかった場合（重複で除去された）、追加確認
  // → 堅実案=標準案=積極案 全部同じ口数の極端なケースへの対処は重複排除で自然に消える
  const plans: PlanEvalResult[] = planDefs.map((def) => ({
    key: def.key,
    name: def.name,
    purpose: def.purpose,
    ...evaluatePlan(input, scenario, def.units, 10, reissue),
  }))

  // ---- 追加1: 最適口数の自動試算 ----
  const optimalUnitsResult = optimalUnitsForPlans

  // ---- 追加2: 必要な戸あたり月額引き上げ（4パターン） ----
  const noBondStrategy: BondStrategy = {
    enabled: false,
    startYear: strategy.startYear,
    unitsPerYear: 0,
    purchaseYears: 0,
    allowEarlyRedemption: false,
  }
  const stress2pctInput: AssociationInput = { ...input, inflationRate: 0.02 }
  const reqCurrentNoBond = requiredMonthlyIncrease(input, scenario, noBondStrategy)
  const reqCurrentWithBond = requiredMonthlyIncrease(input, scenario, strategy)
  const reqStressNoBond = requiredMonthlyIncrease(stress2pctInput, scenario, noBondStrategy)
  const reqStressWithBond = requiredMonthlyIncrease(stress2pctInput, scenario, strategy)

  // ---- 追加3: 棟別の毎月の修繕積立金 ----
  const [danchiAcc, abcAcc, deAcc] = ACCOUNTS
  const danchiFirstYearMonthly = Math.round(annualOf(danchiAcc.reserveAnnualSteps, input.startYear) / danchiAcc.units / 12)
  const danchiLastYearMonthly = Math.round(annualOf(danchiAcc.reserveAnnualSteps, endYear) / danchiAcc.units / 12)
  const abcFirstYearMonthly = Math.round(annualOf(abcAcc.reserveAnnualSteps, input.startYear) / abcAcc.units / 12)
  const abcLastYearMonthly = Math.round(annualOf(abcAcc.reserveAnnualSteps, endYear) / abcAcc.units / 12)
  const deFirstYearMonthly = Math.round(annualOf(deAcc.reserveAnnualSteps, input.startYear) / deAcc.units / 12)
  const deLastYearMonthly = Math.round(annualOf(deAcc.reserveAnnualSteps, endYear) / deAcc.units / 12)

  // ---- 追加4: 資金ショート解消マトリクス ----
  const shortfallMatrix = computeShortfallMatrix(input, scenario, strategy)

  // ---- reserveBoost の情報 ----
  const reserveBoostMeta = input.reserveBoost && input.reserveBoost.addAnnual > 0
    ? {
        fromYear: input.reserveBoost.fromYear,
        perUnitMonth: Math.round(input.reserveBoost.addAnnual / input.units / 12),
        totalExtra: input.reserveBoost.addAnnual * Math.max(0, endYear - input.reserveBoost.fromYear + 1),
      }
    : undefined

  return {
    meta: {
      name: input.name,
      units: input.units,
      openingBalance: input.openingBalance,
      startYear: input.startYear,
      endYear,
      scenarioName: scenario.name,
      inflationRate: input.inflationRate,
      currentUnitsPerYear: strategy.enabled ? strategy.unitsPerYear : 0,
      reissue,
      reserveBoost: reserveBoostMeta,
      // 前提条件セクション用
      priceBaseYear: input.priceBaseYear ?? input.startYear,
      isCertified: input.isCertified,
      purchaseYears: strategy.purchaseYears,
      allowEarlyRedemption: strategy.allowEarlyRedemption,
      bondStartYear: strategy.startYear,
      bondRateStart: scenario.bondRatesByYear[input.startYear] ?? 0,
      depositRate: scenario.depositRate,
      scenarioDescription: scenario.description,
    },
    bigWorks,
    perAccount,
    comparison,
    balanceSeries,
    plans,
    recommendation: {
      unitsPerYear: 80,
      yenPerYear: 80 * BOND_UNIT_YEN,
      firstPurchaseYen: 80 * BOND_UNIT_YEN,
      reason: [
        '眠っている修繕積立金（約1.8億）と毎年の積立を、継続的に運用へ回せる',
        '一括の大口購入より、継続購入の方が累計利息が大きい（お金が働き続けるため）',
        '2035年前後の最低残高を運用なし比で押し上げ、棟別のギリギリな1回目大規模修繕を補える',
        '発行1年後から手数料なしで中途換金でき、2034-35年の大規模修繕にそのまま充当できる',
      ],
    },
    optimalUnits: optimalUnitsResult,
    requiredIncrease: {
      currentInflationNoBond: reqCurrentNoBond,
      currentInflationWithBond: reqCurrentWithBond,
      stress2pctNoBond: reqStressNoBond,
      stress2pctWithBond: reqStressWithBond,
    },
    perAccountMonthly: {
      danchi: { first: danchiFirstYearMonthly, last: danchiLastYearMonthly },
      abc: { first: abcFirstYearMonthly, last: abcLastYearMonthly },
      de: { first: deFirstYearMonthly, last: deLastYearMonthly },
      abcResident: {
        first: abcFirstYearMonthly + danchiFirstYearMonthly,
        last: abcLastYearMonthly + danchiLastYearMonthly,
      },
      deResident: {
        first: deFirstYearMonthly + danchiFirstYearMonthly,
        last: deLastYearMonthly + danchiLastYearMonthly,
      },
    },
    shortfallMatrix,
  }
}

/** 現在の設定でレポート用データを作る際に使う戦略（未使用でも型のため） */
export type { AssociationInput, BondStrategy }

// ============================================================================
// findOptimalUnits
// ============================================================================

export interface OptimalUnitsResult {
  /** 運用メリット（期末総資産の差）が最大になる口数/年 */
  optimalUnits: number
  /** 最大メリット（円）*/
  optimalBenefit: number
  /** 全 purchaseYears 年を連続して同一口数で買い切れる最大口数（実質上限）*/
  maxContinuousUnits: number
}

export function findOptimalUnits(
  input: AssociationInput,
  scenario: RateScenario,
  reissue = false
): OptimalUnitsResult {
  const baseline = simulateWithoutBond(input, scenario)
  const PURCHASE_YEARS = 10

  let optimalUnits = 10
  let optimalBenefit = -Infinity
  let maxContinuousUnits = 0

  for (let u = 10; u <= 300; u += 10) {
    const res = simulate(input, scenario, {
      enabled: true,
      startYear: input.startYear,
      unitsPerYear: u,
      purchaseYears: PURCHASE_YEARS,
      allowEarlyRedemption: true,
      reissue,
    })

    const benefit = res.endingTotal - baseline.endingTotal

    if (benefit > optimalBenefit) {
      optimalBenefit = benefit
      optimalUnits = u
    }

    // 全 purchaseYears 年を連続して同一口数で買い切れるか判定
    const targetYears = Array.from({ length: PURCHASE_YEARS }, (_, i) => input.startYear + i)
    const purchases = targetYears.map((yr) => {
      const row = res.rows.find((r) => r.year === yr)
      return row ? row.bondPurchase : 0
    })
    const allPositive = purchases.every((p) => p > 0)
    const allSame = purchases.every((p) => p === purchases[0])
    if (allPositive && allSame) {
      maxContinuousUnits = u
    }
  }

  return { optimalUnits, optimalBenefit, maxContinuousUnits }
}

// ============================================================================
// requiredMonthlyIncrease
// ============================================================================

export function requiredMonthlyIncrease(
  input: AssociationInput,
  scenario: RateScenario,
  strategy: BondStrategy
): number {
  const baseResult = simulate(input, scenario, strategy)
  if (!baseResult.hasShortfall) return 0

  const fromYear = input.reserveBoost?.fromYear ?? input.startYear

  let lo = 0
  let hi = 100_000

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const addAnnual = mid * input.units * 12
    const boostedInput: AssociationInput = {
      ...input,
      reserveBoost: { fromYear, addAnnual },
    }
    const res = simulate(boostedInput, scenario, strategy)
    if (!res.hasShortfall) {
      hi = mid
    } else {
      lo = mid + 1
    }
  }

  return lo
}

// ============================================================================
// computeShortfallMatrix
// 積立金の引き上げ額（戸あたり月額）× すまい・る債の有無 のマトリクスで、
// 資金ショートが解消するかどうかを一覧できるようにする。
// ============================================================================

/** マトリクスの行（引き上げ額・円/戸月）。+0 は現行のまま（引き上げなし）。 */
export const SHORTFALL_MATRIX_LEVELS = [0, 1000, 2000, 3000, 5000, 8000] as const

export interface ShortfallMatrixCell {
  perUnitMonth: number
  shortfallYear: number | null
  minBalance: { value: number; year: number }
}

export interface ShortfallMatrixResult {
  /** 引き上げの適用開始年度 */
  fromYear: number
  /** 運用なし列（5水準） */
  noBond: ShortfallMatrixCell[]
  /** すまい・る債あり列（現在の口数・継続運用設定、5水準） */
  withBond: ShortfallMatrixCell[]
  /** 運用なし列で最初にショートが解消される水準（円/戸月）。どの水準でも解消しなければ null */
  firstResolvedNoBond: number | null
  /** すまい・る債あり列で最初にショートが解消される水準（円/戸月）。どの水準でも解消しなければ null */
  firstResolvedWithBond: number | null
  /** 資金ショート解消に必要な戸あたり月額引き上げ（運用なし・厳密値。requiredMonthlyIncrease と同じロジック） */
  requiredNoBond: number
  /** 資金ショート解消に必要な戸あたり月額引き上げ（運用あり・厳密値） */
  requiredWithBond: number
  /** 現在の前提（引き上げ0円・運用なし）で、そもそも資金ショートが発生しないか */
  noShortfallAtBaseline: boolean
}

/**
 * 積立金の引き上げ額（戸あたり月額・SHORTFALL_MATRIX_LEVELS の5水準）×
 * 「運用なし」「すまい・る債あり（現在の設定）」の2列で、資金ショートの有無と最低残高を一覧化する。
 * input が保持する既存の reserveBoost は無視し、水準ごとに reserveBoost を独立して設定して試算する
 * （+0 の行は reserveBoost なし＝現行の段階増額計画のまま）。
 */
export function computeShortfallMatrix(
  input: AssociationInput,
  scenario: RateScenario,
  strategy: BondStrategy
): ShortfallMatrixResult {
  const fromYear = input.reserveBoost?.fromYear ?? input.startYear
  const cleanInput: AssociationInput = { ...input, reserveBoost: undefined }
  const noBondStrategy: BondStrategy = {
    enabled: false,
    startYear: strategy.startYear,
    unitsPerYear: 0,
    purchaseYears: 0,
    allowEarlyRedemption: false,
  }

  function evalLevel(perUnitMonth: number, strat: BondStrategy): ShortfallMatrixCell {
    const boostedInput: AssociationInput =
      perUnitMonth > 0
        ? { ...cleanInput, reserveBoost: { fromYear, addAnnual: perUnitMonth * input.units * 12 } }
        : cleanInput
    const res = simulate(boostedInput, scenario, strat)
    return {
      perUnitMonth,
      shortfallYear: res.firstShortfallYear,
      minBalance: minBalance(res),
    }
  }

  const noBond = SHORTFALL_MATRIX_LEVELS.map((lvl) => evalLevel(lvl, noBondStrategy))
  const withBond = SHORTFALL_MATRIX_LEVELS.map((lvl) => evalLevel(lvl, strategy))

  const firstResolvedNoBond = noBond.find((c) => c.shortfallYear === null)?.perUnitMonth ?? null
  const firstResolvedWithBond = withBond.find((c) => c.shortfallYear === null)?.perUnitMonth ?? null

  const requiredNoBond = requiredMonthlyIncrease(cleanInput, scenario, noBondStrategy)
  const requiredWithBond = requiredMonthlyIncrease(cleanInput, scenario, strategy)

  return {
    fromYear,
    noBond,
    withBond,
    firstResolvedNoBond,
    firstResolvedWithBond,
    requiredNoBond,
    requiredWithBond,
    noShortfallAtBaseline: requiredNoBond === 0,
  }
}
