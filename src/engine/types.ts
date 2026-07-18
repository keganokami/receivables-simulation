// ============================================================================
// ドメインモデル（マンション管理組合 修繕積立金シミュレーション）
//
// 金額の単位はすべて「円」。表示時に万円へ変換する。
// 年度は西暦（例: 2026）で扱う。
// ============================================================================

/** すまい・る債 1口の金額（円） */
export const BOND_UNIT_YEN = 500_000

/** 段階増額方式の修繕積立金（戸あたり月額）。fromYear 以降この金額が適用される。 */
export interface ReserveStep {
  fromYear: number
  /** 1戸あたりの月額修繕積立金（円） */
  monthlyPerUnit: number
}

/** 長期修繕計画の支出（大規模修繕・計画修繕） */
export interface RepairItem {
  year: number
  /** 支出額（円・計画時点＝基準年の価格） */
  amount: number
  label: string
}

/** その他収支（駐車場収入・雑収入・臨時支出など）。amount は正=収入 / 負=支出。 */
export interface OtherCashflow {
  year: number
  amount: number
  note?: string
}

/** 管理組合の前提条件 */
export interface AssociationInput {
  name: string
  /** 戸数 */
  units: number
  /** 竣工年（西暦）。築年数の計算に使う。 */
  builtYear: number
  /** シミュレーション開始年度（西暦） */
  startYear: number
  /** シミュレーション年数 */
  horizonYears: number
  /** 開始時点の修繕積立金残高（円） */
  openingBalance: number
  /** 段階増額計画（修繕積立金の戸あたり月額の推移） */
  reserveSteps: ReserveStep[]
  /**
   * 年間修繕積立金収入を直接指定する段階（円/年）。
   * 実データ（長期修繕計画の年度合計）を使う場合はこちらを使用する。
   * 指定があれば reserveSteps（戸あたり月額）より優先される。
   */
  reserveAnnualSteps?: { fromYear: number; annual: number }[]
  /** 専有面積合計（㎡）。円/㎡・月 と 年額の換算に使う。 */
  senyuArea?: number
  /**
   * 修繕積立金の引き上げシミュレーション（定額の上乗せ）。
   * fromYear 以降、年間修繕積立金収入に addAnnual（円/年）を加算する。
   * 段階増額（5年ごとの定額改定）に上乗せする形で「いくら上げれば足りるか」を検討する。
   */
  reserveBoost?: { fromYear: number; addAnnual: number }
  /** 長期修繕計画の支出 */
  repairPlan: RepairItem[]
  /** その他収支 */
  otherCashflows: OtherCashflow[]
  /** 管理計画認定マンションか（すまい・る債の利率が優遇される） */
  isCertified: boolean
  /**
   * 修繕費の物価上昇率（年率, 例 0.02 = 2%）。
   * 長期修繕計画の金額は基準年価格なので、将来支出に escalation を掛ける。
   */
  inflationRate: number
  /** 修繕費の物価上昇率の基準年（省略時は startYear）。長期修繕計画の単価時点年を指定。 */
  priceBaseYear?: number
}

/** 利率シナリオ（日本の金利情勢を表現） */
export interface RateScenario {
  name: string
  description: string
  /**
   * その年度に新規発行されるすまい・る債の「10年満期時 年平均利率」(%)。
   * 西暦 -> 利率(%)。未定義の年は最後に定義された値を踏襲する。
   */
  bondRatesByYear: Record<number, number>
  /** 管理計画認定マンション向けの利率上乗せ(%)（例 0.05） */
  certifiedBonus: number
  /** 普通預金/定期等の利率(%)（運用しない場合の比較・余剰資金の運用） */
  depositRate: number
}

/** すまい・る債の運用戦略 */
export interface BondStrategy {
  /** 運用するか */
  enabled: boolean
  /** 購入開始年度（西暦） */
  startYear: number
  /** 毎年購入する口数（同一口数ルール）。1口=50万円。 */
  unitsPerYear: number
  /** 継続購入する年数（最大10） */
  purchaseYears: number
  /** 資金不足時に中途換金して充当するか（発行から1年経過した債券のみ対象） */
  allowEarlyRedemption: boolean
}

/** 1年度分の計算結果 */
export interface YearResult {
  year: number
  /** 築年数（年度末時点） */
  buildingAge: number
  /** 修繕積立金収入 */
  reserveIncome: number
  /** その他収支（純額） */
  otherNet: number
  /** すまい・る債の受取利息 */
  bondInterest: number
  /** 余剰資金（普通預金分）の受取利息 */
  depositInterest: number
  /** 満期償還で戻った元本 */
  maturedPrincipal: number
  /** すまい・る債の新規購入額（流動資金 -> 債券へ） */
  bondPurchase: number
  /** 中途換金した額（債券 -> 流動資金へ） */
  earlyRedemption: number
  /** 修繕支出（物価調整後） */
  repairExpense: number
  /** 年度末の流動資金（普通預金分） */
  liquidEnd: number
  /** 年度末のすまい・る債 保有残高（元本） */
  bondHoldings: number
  /** 年度末の総資産（流動 + 債券） */
  totalEnd: number
  /** 資金ショートしたか（総資産が負＝債券を全部換金しても足りない） */
  shortfall: boolean
  /** 不足額（shortfall 時のみ正の値） */
  shortfallAmount: number
  /** 累計受取利息（債券＋預金） */
  cumulativeInterest: number
}

export interface SimulationResult {
  rows: YearResult[]
  /** 期間中に一度でも資金ショートしたか */
  hasShortfall: boolean
  /** 最初に資金ショートした年度（なければ null） */
  firstShortfallYear: number | null
  /** 期末総資産 */
  endingTotal: number
  /** 累計受取利息 */
  totalInterest: number
}
