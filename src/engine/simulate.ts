import {
  AssociationInput,
  BondStrategy,
  RateScenario,
  SimulationResult,
  YearResult,
  BOND_UNIT_YEN,
} from './types'

// ============================================================================
// すまい・る債のモデル化メモ
//
// - 1口 50万円。年1回・最大10回（10年）継続購入。各年度は「同一口数」。
// - 利率は発行年度（ヴィンテージ）ごとに固定。本シミュレーションでは
//   「10年満期時 年平均利率」をフラット利率として近似して毎年利息を計上する。
//   （実際の債券は後半ほど高い段階金利だが、平均利率で近似しても満期までの
//    受取利息総額はおおむね一致する。長期計画の概算用途として妥当。）
// - 利息は発行翌年から満期年まで毎年受取り、満期（発行+10年）に元本償還。
// - 購入上限 = 「その年の修繕積立金収入」＋「前年度末の積立金残高」。
// - 中途換金は発行から1年以上経過した債券のみ可能（資金不足時の充当に使用）。
// ============================================================================

const BOND_TERM_YEARS = 10

interface Tranche {
  issueYear: number
  /** 元本（円） */
  principal: number
  /** フラット近似利率（小数, 例 0.00525） */
  rate: number
}

/** その年度の修繕積立金 年間収入を返す。年額指定があればそれを優先。引き上げ設定も反映。 */
function annualReserveFor(input: AssociationInput, year: number): number {
  let base: number
  if (input.reserveAnnualSteps && input.reserveAnnualSteps.length > 0) {
    let value = 0
    let bestFrom = -Infinity
    for (const step of input.reserveAnnualSteps) {
      if (step.fromYear <= year && step.fromYear > bestFrom) {
        bestFrom = step.fromYear
        value = step.annual
      }
    }
    base = value
  } else {
    // 戸あたり月額 × 戸数 × 12
    let monthly = 0
    let bestFrom = -Infinity
    for (const step of input.reserveSteps) {
      if (step.fromYear <= year && step.fromYear > bestFrom) {
        bestFrom = step.fromYear
        monthly = step.monthlyPerUnit
      }
    }
    base = monthly * input.units * 12
  }
  // 引き上げシミュレーション（fromYear 以降に定額 addAnnual を上乗せ）
  const boost = input.reserveBoost
  if (boost && boost.addAnnual !== 0 && year >= boost.fromYear) {
    base += boost.addAnnual
  }
  return base
}

/** その年度に新規発行されるすまい・る債の利率(小数)を返す */
function bondRateFor(scenario: RateScenario, input: AssociationInput, year: number): number {
  const years = Object.keys(scenario.bondRatesByYear)
    .map(Number)
    .sort((a, b) => a - b)
  let pct = 0
  for (const y of years) {
    if (y <= year) pct = scenario.bondRatesByYear[y]
  }
  if (input.isCertified) pct += scenario.certifiedBonus
  return pct / 100
}

/** その年度の修繕支出（物価調整後）を返す */
function repairExpenseFor(input: AssociationInput, year: number): number {
  let total = 0
  for (const item of input.repairPlan) {
    if (item.year === year) {
      const baseYear = input.priceBaseYear ?? input.startYear
      const escalation = Math.pow(1 + input.inflationRate, year - baseYear)
      total += item.amount * escalation
    }
  }
  return total
}

/** その年度のその他収支（純額）を返す */
function otherNetFor(input: AssociationInput, year: number): number {
  let total = 0
  for (const cf of input.otherCashflows) {
    if (cf.year === year) total += cf.amount
  }
  return total
}

/**
 * シミュレーション本体。
 * strategy.enabled = false にすると「全額 普通預金（運用なし）」シナリオになる。
 */
export function simulate(
  input: AssociationInput,
  scenario: RateScenario,
  strategy: BondStrategy
): SimulationResult {
  const rows: YearResult[] = []
  const tranches: Tranche[] = []

  let liquid = input.openingBalance
  let cumulativeInterest = 0
  let firstShortfallYear: number | null = null

  // 前年度末の積立金残高（購入上限の算定に使う）。初年度は開始残高。
  let priorYearEndTotal = input.openingBalance

  // 継続購入の同一口数管理。null=シリーズ未開始、0=不成立/終了済み、正数=購入口数
  let continuationUnits: number | null = null

  const depositRate = scenario.depositRate / 100
  const lastYear = input.startYear + input.horizonYears - 1

  for (let year = input.startYear; year <= lastYear; year++) {
    const reserveIncome = annualReserveFor(input, year)
    const otherNet = otherNetFor(input, year)
    const repairExpense = repairExpenseFor(input, year)

    // --- 利息計上（発行翌年〜満期年に毎年受取） ---
    let bondInterest = 0
    for (const t of tranches) {
      if (year > t.issueYear && year <= t.issueYear + BOND_TERM_YEARS) {
        bondInterest += t.principal * t.rate
      }
    }
    // 預金利息は期首残高ベースの単利近似（厳密には期中変動を加味しないが長期計画の概算として妥当）
    const depositInterest = Math.max(0, liquid) * depositRate

    // --- 満期償還（発行 + 10年） ---
    let maturedPrincipal = 0
    for (let i = tranches.length - 1; i >= 0; i--) {
      if (tranches[i].issueYear + BOND_TERM_YEARS === year) {
        maturedPrincipal += tranches[i].principal
        tranches.splice(i, 1)
      }
    }

    // --- 収入・利息・償還を流動資金へ反映 ---
    liquid += reserveIncome + otherNet + bondInterest + depositInterest + maturedPrincipal

    // --- 修繕支出 ---
    liquid -= repairExpense

    // --- 資金不足時：中途換金で充当（発行から1年以上経過した債券のみ） ---
    // 「発行1年以上経過」の条件は年次粒度の近似（実際は発行日から1年）
    let earlyRedemption = 0
    if (liquid < 0 && strategy.allowEarlyRedemption) {
      for (let i = 0; i < tranches.length && liquid < 0; i++) {
        if (year - tranches[i].issueYear >= 1) {
          const need = -liquid
          const take = Math.min(need, tranches[i].principal)
          tranches[i].principal -= take
          liquid += take
          earlyRedemption += take
        }
      }
      // principal が 0 になった債券を除去
      for (let i = tranches.length - 1; i >= 0; i--) {
        if (tranches[i].principal <= 0) tranches.splice(i, 1)
      }
    }

    // --- 資金ショート判定（総資産ベース: 債券を全部換金しても足りない場合のみショート） ---
    let shortfall = false
    let shortfallAmount = 0
    const bondHoldingsForShortfall = tranches.reduce((s, t) => s + t.principal, 0)
    const totalForShortfall = liquid + bondHoldingsForShortfall
    if (totalForShortfall < -1) {
      shortfall = true
      shortfallAmount = -totalForShortfall
      if (firstShortfallYear === null) firstShortfallYear = year
    }

    // --- すまい・る債の新規購入（同一口数継続ルール） ---
    let bondPurchase = 0
    const inPurchaseWindow =
      strategy.enabled &&
      strategy.unitsPerYear > 0 &&
      year >= strategy.startYear &&
      year < strategy.startYear + Math.min(strategy.purchaseYears, BOND_TERM_YEARS)
    if (inPurchaseWindow) {
      // 購入上限の「前年度末残高」は流動＋債券の総資産（JHF規程上の積立金残高に債券保有分を含む解釈）
      const maxUnitsByRule = Math.floor((reserveIncome + priorYearEndTotal) / BOND_UNIT_YEN)
      // 手元資金で買える口数
      const maxUnitsByCash = Math.floor(liquid / BOND_UNIT_YEN)

      if (continuationUnits === null) {
        // 初回: 要求口数を買えるか確認
        const units = Math.min(strategy.unitsPerYear, maxUnitsByRule, maxUnitsByCash)
        if (units >= strategy.unitsPerYear) {
          // 全量購入できる → シリーズ開始
          continuationUnits = units
          bondPurchase = continuationUnits * BOND_UNIT_YEN
          liquid -= bondPurchase
          tranches.push({
            issueYear: year,
            principal: bondPurchase,
            rate: bondRateFor(scenario, input, year),
          })
        } else {
          // 全量買えない → シリーズ不成立（以降も購入しない）
          continuationUnits = 0
        }
      } else if (continuationUnits > 0) {
        // 継続中: 同一口数を買えるか確認
        if (continuationUnits <= maxUnitsByRule && continuationUnits <= maxUnitsByCash) {
          bondPurchase = continuationUnits * BOND_UNIT_YEN
          liquid -= bondPurchase
          tranches.push({
            issueYear: year,
            principal: bondPurchase,
            rate: bondRateFor(scenario, input, year),
          })
        } else {
          // 同一口数を買えない → シリーズ終了（部分購入なし、以降も購入しない）
          continuationUnits = 0
        }
      }
      // continuationUnits === 0 の場合: 購入しない
    }

    cumulativeInterest += bondInterest + depositInterest

    const bondHoldings = tranches.reduce((s, t) => s + t.principal, 0)
    const totalEnd = liquid + bondHoldings

    rows.push({
      year,
      buildingAge: year - input.builtYear,
      reserveIncome,
      otherNet,
      bondInterest,
      depositInterest,
      maturedPrincipal,
      bondPurchase,
      earlyRedemption,
      repairExpense,
      liquidEnd: liquid,
      bondHoldings,
      totalEnd,
      shortfall,
      shortfallAmount,
      cumulativeInterest,
    })

    priorYearEndTotal = totalEnd
  }

  return {
    rows,
    hasShortfall: firstShortfallYear !== null,
    firstShortfallYear,
    endingTotal: rows.length ? rows[rows.length - 1].totalEnd : 0,
    totalInterest: cumulativeInterest,
  }
}

/** 「運用なし（全額普通預金）」シナリオを生成して比較する */
export function simulateWithoutBond(
  input: AssociationInput,
  scenario: RateScenario
): SimulationResult {
  return simulate(input, scenario, {
    enabled: false,
    startYear: input.startYear,
    unitsPerYear: 0,
    purchaseYears: 0,
    allowEarlyRedemption: false,
  })
}
