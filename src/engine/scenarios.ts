import { RateScenario } from './types'

// ============================================================================
// 利率シナリオ（日本の金利情勢の想定）
//
// 基準は2026年度すまい・る債の「10年満期時 年平均利率」約2.0%
// （管理計画認定マンション +0.1% → 約2.1%）。2025年度は0.525%だったが、
// 日銀の利上げ（政策金利1.0%）・長期金利上昇を受けて大幅に上昇した。
// 定期・普通預金も上昇し概ね 0.3〜1.0% 程度。先行きを3本のシナリオで用意。
//
// ※ これらは検討用の前提値。実際の利率は毎年度 住宅金融支援機構が決定する。
//   最新値が出たら bondRatesByYear を更新して使う（レポートのClaude所見も参照）。
// ============================================================================

/** ある開始値から終了値へ線形に変化する利率テーブルを作る */
function ramp(startYear: number, endYear: number, startPct: number, endPct: number): Record<number, number> {
  const out: Record<number, number> = {}
  const span = Math.max(1, endYear - startYear)
  for (let y = startYear; y <= endYear; y++) {
    const t = (y - startYear) / span
    out[y] = Math.round((startPct + (endPct - startPct) * t) * 1000) / 1000
  }
  return out
}

export const RATE_SCENARIOS: RateScenario[] = [
  {
    name: '横ばい（2%前後）',
    description: '現在の金利水準が続く想定。すまい・る債利率は2.0%前後で横ばい。',
    bondRatesByYear: ramp(2026, 2055, 2.0, 2.0),
    certifiedBonus: 0.1,
    depositRate: 0.3,
  },
  {
    name: '標準（緩やかに上昇）',
    description: '正常化が続き長期金利が緩やかに上昇。すまい・る債利率は2.0%→2.5%程度へ。',
    bondRatesByYear: ramp(2026, 2055, 2.0, 2.5),
    certifiedBonus: 0.1,
    depositRate: 0.6,
  },
  {
    name: '金利上昇',
    description: 'インフレ継続で更に金利上昇。すまい・る債利率は2.0%→3.5%程度へ。',
    bondRatesByYear: ramp(2026, 2055, 2.0, 3.5),
    certifiedBonus: 0.1,
    depositRate: 1.0,
  },
]

export const DEFAULT_SCENARIO = RATE_SCENARIOS[1] // 標準
