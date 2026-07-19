import { useMemo, useState, type ReactNode } from 'react'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { simulate } from './engine/simulate'
import { RATE_SCENARIOS } from './engine/scenarios'
import { GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY } from './engine/geoSaito'
import { AssociationInput } from './engine/types'
import { requiredMonthlyIncrease } from './engine/report'
import {
  applyCostReductionsWithDetail,
  isMajorRepairLabel,
  CostReductionOptions,
  DEFAULT_COST_REDUCTION_OPTIONS,
} from './engine/costReduction'
import { yen2man, pct } from './ui/format'

// ============================================================================
// 修繕費の削減シミュレーション ページ
//
// 既存シミュレーターとは別に「修繕費そのものを抑える一般的な手法」を試し、
// どこまで削減できるか・資金ショートがどう改善するかを検討する。
// 前提：ジオ彩都（GEO_SAITO_COMBINED）・すまい・る債60口/年（GEO_SAITO_STRATEGY）・
//       利率シナリオ「標準」固定。物価上昇率のみこのページ内で可変。
// ============================================================================

const SCENARIO = RATE_SCENARIOS[1] // 標準（緩やかに上昇）固定
const STRATEGY = GEO_SAITO_STRATEGY

const CYCLE_CHOICES = [12, 13, 15, 18] as const

/**
 * repairPlan の合計額（基準年価格・試算期間内のみ）。
 * 「削減内訳」セクションはすべてこの基準（物価調整前）で統一する。物価設定を変えても値は変わらない。
 * 物価上昇の影響（simulate の物価調整後 repairExpense）は「資金への影響」セクションで別途示す。
 */
function sumRepairPlanBaseYear(input: AssociationInput): number {
  const endYear = input.startYear + input.horizonYears - 1
  return input.repairPlan
    .filter((r) => r.year >= input.startYear && r.year <= endYear)
    .reduce((s, r) => s + r.amount, 0)
}

export default function SavingsPage() {
  const [inflationRate, setInflationRate] = useState(0)
  const [cycleNewCycle, setCycleNewCycle] = useState<number>(12)
  const [unifyEnabled, setUnifyEnabled] = useState(false)
  const [unifyRate, setUnifyRate] = useState(0.05)
  const [designEnabled, setDesignEnabled] = useState(false)
  const [designRate, setDesignRate] = useState(0.1)
  const [consultantRate, setConsultantRate] = useState(0.05)
  const [parkingEnabled, setParkingEnabled] = useState(false)
  const [parkingRate, setParkingRate] = useState(0.5)
  const [scopeEnabled, setScopeEnabled] = useState(false)
  const [scopeRate, setScopeRate] = useState(0.03)

  const baseInput = useMemo<AssociationInput>(
    () => ({ ...GEO_SAITO_COMBINED, inflationRate }),
    [inflationRate]
  )

  const opts = useMemo<CostReductionOptions>(
    () => ({
      cycleExtension: { enabled: cycleNewCycle !== 12, newCycle: cycleNewCycle },
      unifyBuildings: { enabled: unifyEnabled, savingRate: unifyRate },
      designSupervision: { enabled: designEnabled, savingRate: designRate, consultantFeeRate: consultantRate },
      parkingReduction: { enabled: parkingEnabled, reductionRate: parkingRate },
      scopeOptimization: { enabled: scopeEnabled, reductionRate: scopeRate },
    }),
    [cycleNewCycle, unifyEnabled, unifyRate, designEnabled, designRate, consultantRate, parkingEnabled, parkingRate, scopeEnabled, scopeRate]
  )

  const reducedResult = useMemo(() => applyCostReductionsWithDetail(baseInput, opts), [baseInput, opts])
  const reducedInput = reducedResult.input
  const deferredOutOfHorizon = reducedResult.deferredOutOfHorizon

  const resBefore = useMemo(() => simulate(baseInput, SCENARIO, STRATEGY), [baseInput])
  const resAfter = useMemo(() => simulate(reducedInput, SCENARIO, STRATEGY), [reducedInput])

  // 削減内訳は「基準年価格」で統一する（物価設定に依存しない）。物価調整後の資金繰りは別セクションで扱う。
  const priceBaseYear = baseInput.priceBaseYear ?? baseInput.startYear
  const totalRepairBefore = useMemo(() => sumRepairPlanBaseYear(baseInput), [baseInput])
  const totalRepairAfter = useMemo(() => sumRepairPlanBaseYear(reducedInput), [reducedInput])
  const repairReduction = totalRepairBefore - totalRepairAfter
  // 「うち期間外へ繰り延べ」＝周期延長で試算期間の外に押し出された工事費（削減ではない）
  const deferredAmount = deferredOutOfHorizon.totalAmount
  // 「実質的な削減額」＝見かけの削減額から繰り延べ分を除いた、正味の削減効果
  const realReduction = repairReduction - deferredAmount
  const endYear = baseInput.startYear + baseInput.horizonYears - 1
  const assetImprovement = resAfter.endingTotal - resBefore.endingTotal

  const requiredIncreaseBefore = useMemo(
    () => requiredMonthlyIncrease(baseInput, SCENARIO, STRATEGY),
    [baseInput]
  )
  const requiredIncreaseAfter = useMemo(
    () => requiredMonthlyIncrease(reducedInput, SCENARIO, STRATEGY),
    [reducedInput]
  )

  // 削減内訳: 各レバーを「単独で」現在の率で適用した場合の削減額（相互作用は除いた参考値）
  // 修繕周期の延長のみ「期間外への繰り延べ」を伴うため、amount（見かけの削減額）と
  // deferred（うち期間外繰り延べ）・real（実質削減額 = amount − deferred）を分けて返す。
  const leverBreakdown = useMemo(() => {
    function soloResult(o: Partial<CostReductionOptions>): { amount: number; deferred: number; real: number } {
      const soloOpts: CostReductionOptions = {
        cycleExtension: { ...DEFAULT_COST_REDUCTION_OPTIONS.cycleExtension },
        unifyBuildings: { ...DEFAULT_COST_REDUCTION_OPTIONS.unifyBuildings },
        designSupervision: { ...DEFAULT_COST_REDUCTION_OPTIONS.designSupervision },
        parkingReduction: { ...DEFAULT_COST_REDUCTION_OPTIONS.parkingReduction },
        scopeOptimization: { ...DEFAULT_COST_REDUCTION_OPTIONS.scopeOptimization },
        ...o,
      }
      const { input: inp, deferredOutOfHorizon: def } = applyCostReductionsWithDetail(baseInput, soloOpts)
      const amount = totalRepairBefore - sumRepairPlanBaseYear(inp)
      return { amount, deferred: def.totalAmount, real: amount - def.totalAmount }
    }
    return [
      {
        key: 'cycle',
        label: `修繕周期の延長（${cycleNewCycle}年）`,
        active: cycleNewCycle !== 12,
        ...soloResult({ cycleExtension: { enabled: cycleNewCycle !== 12, newCycle: cycleNewCycle } }),
      },
      {
        key: 'unify',
        label: `棟の一括発注（${pct(unifyRate * 100)}削減）`,
        active: unifyEnabled,
        ...soloResult({ unifyBuildings: { enabled: true, savingRate: unifyRate } }),
      },
      {
        key: 'design',
        label: `設計監理方式（${pct(designRate * 100)}削減 − コンサル${pct(consultantRate * 100)}）`,
        active: designEnabled,
        ...soloResult({
          designSupervision: { enabled: true, savingRate: designRate, consultantFeeRate: consultantRate },
        }),
      },
      {
        key: 'parking',
        label: `機械式駐車場の見直し（${pct(parkingRate * 100)}削減）`,
        active: parkingEnabled,
        ...soloResult({ parkingReduction: { enabled: true, reductionRate: parkingRate } }),
      },
      {
        key: 'scope',
        label: `仕様・数量の精査（${pct(scopeRate * 100)}削減）`,
        active: scopeEnabled,
        ...soloResult({ scopeOptimization: { enabled: true, reductionRate: scopeRate } }),
      },
    ]
  }, [
    baseInput,
    totalRepairBefore,
    cycleNewCycle,
    unifyEnabled,
    unifyRate,
    designEnabled,
    designRate,
    consultantRate,
    parkingEnabled,
    parkingRate,
    scopeEnabled,
    scopeRate,
  ])

  // 大規模修繕スケジュールの比較（削減前 vs 削減後・除外分）
  const scheduleRows = useMemo(() => {
    const originalMajor = baseInput.repairPlan
      .filter((r) => isMajorRepairLabel(r.label))
      .sort((a, b) => a.year - b.year)
    return originalMajor.map((orig) => {
      const after = reducedInput.repairPlan.find((r) => r.label === orig.label)
      return {
        label: orig.label,
        beforeYear: orig.year,
        beforeAmount: orig.amount,
        afterYear: after?.year ?? null,
        afterAmount: after?.amount ?? null,
        excluded: !after,
      }
    })
  }, [baseInput, reducedInput])

  // 残高推移グラフ
  const chartData = useMemo(
    () =>
      resAfter.rows.map((r, i) => ({
        year: r.year,
        総資産_削減前: Math.round((resBefore.rows[i]?.totalEnd ?? 0) / 10_000),
        総資産_削減後: Math.round(r.totalEnd / 10_000),
        修繕支出_削減後: Math.round(r.repairExpense / 10_000),
      })),
    [resAfter, resBefore]
  )

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-xs leading-relaxed space-y-1">
        <p className="font-semibold">注記（正直に）</p>
        <p>
          このページの削減率は<strong>利用者が置く仮定値</strong>です。手法ごとの削減率について公的な統計・実績値は公表されていません。
          実際の削減額は建物診断・見積り・発注方式によって大きく変わります。試算はジオ彩都いろどりの丘（372戸）の実データ・すまい・る債60口/年・利率シナリオ「標準」を前提にしています。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        {/* ===== 左: 削減レバーの操作パネル ===== */}
        <aside className="space-y-4">
          <Panel title="物価上昇率（共通の前提）">
            <Field label={`修繕費の物価上昇率: ${pct(inflationRate * 100)}/年`}>
              <input
                type="range"
                min={0}
                max={4}
                step={0.1}
                value={inflationRate * 100}
                onChange={(e) => setInflationRate(Number(e.target.value) / 100)}
                className="w-full"
              />
              <div className="flex gap-1 mt-1">
                {[
                  { v: 0, label: '0%' },
                  { v: 1, label: '1%' },
                  { v: 2, label: '2%' },
                  { v: 2.6, label: '2.6%' },
                  { v: 3, label: '3%' },
                ].map((p) => (
                  <button
                    key={p.v}
                    className={`flex-1 text-xs rounded px-1 py-1 border ${
                      Math.abs(inflationRate * 100 - p.v) < 0.05
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'border-slate-300 hover:bg-slate-50'
                    }`}
                    onClick={() => setInflationRate(p.v / 100)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>
          </Panel>

          <Panel title="① 修繕周期の延長">
            <Field label="大規模修繕の周期">
              <select
                className="w-full border border-slate-300 rounded-md py-1.5 px-2 text-sm"
                value={cycleNewCycle}
                onChange={(e) => setCycleNewCycle(Number(e.target.value))}
              >
                {CYCLE_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c}年{c === 12 ? '（現行）' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Note>
              国交省「令和3年度マンション大規模修繕工事に関する実態調査」では最多が
              <strong>13年（23.1%）</strong>、<strong>12〜15年で全体の約70%</strong>。12年は法定基準ではなく、
              ガイドラインの周期も「一般的な仕様・工法を想定した目安」です。高耐久塗料・長寿命シーリング等により
              <strong>16〜18年周期</strong>を採用する動きもありますが、<strong>周期延長は建物診断による検証が前提</strong>で、
              劣化を放置すると却って高額になります。また建築基準法により外壁タイル等は
              <strong>10年毎に全面打診調査</strong>が義務です（3年以内に外壁改修を行う場合はその時まで）。
            </Note>
            <Warning>
              <p>
                修繕周期の延長は、30年の試算期間内では<strong>「先送り」</strong>として現れます。建物の生涯で見れば実施回数が減るため長期的な削減効果はありますが、
                <strong>試算期間の外に出た工事費が「削減」に見える</strong>点にご注意ください。
              </p>
              <p>
                <strong>物価上昇率を上げると、先送りした工事はインフレ分だけ高くなります</strong>
                （例：物価2%では周期13年・15年の削減額はマイナスになります）。物価スライダーを動かして確認できます。
              </p>
              <p>
                <strong>先送りした工事は、物価上昇分だけ将来の金額が大きくなります。</strong>
                例：周期18年で計画期間外へ出る2件は、基準年価格で計6.2億円ですが、物価2%が続くと繰り延べ先の年には計12.8億円相当になります。
                <strong>支出が消えるのではなく、より高くなって先に出てくる</strong>点にご注意ください。
              </p>
              <p>
                周期延長は<strong>建物診断による検証が前提</strong>です。劣化を放置すると却って高額になります。
              </p>
            </Warning>
          </Panel>

          <Panel title="② 棟の一括発注">
            <Toggle
              label="ABC棟の大規模修繕をDE棟の年に統合する"
              checked={unifyEnabled}
              onChange={setUnifyEnabled}
            />
            <SliderField
              label="削減率"
              value={unifyRate}
              onChange={setUnifyRate}
              min={0}
              max={0.15}
              step={0.01}
              disabled={!unifyEnabled}
            />
            <Note>
              足場（直接仮設）は棟ごとに必要なため削減対象になりにくく、削減できるのは
              <strong>共通仮設（現場事務所・仮囲い等）と設計監理費の重複分</strong>が中心です。
              一括発注しても費用は<strong>棟ごとに按分</strong>して各棟会計から支出する必要があり、棟の大規模修繕には
              <strong>棟総会決議</strong>が必要な点にも注意してください。
            </Note>
          </Panel>

          <Panel title="③ 設計監理方式（相見積り）">
            <Toggle
              label="設計監理方式（相見積り）を導入する"
              checked={designEnabled}
              onChange={setDesignEnabled}
            />
            <SliderField
              label="削減率（相見積りによる）"
              value={designRate}
              onChange={setDesignRate}
              min={0}
              max={0.2}
              step={0.01}
              disabled={!designEnabled}
            />
            <SliderField
              label="コンサルタント費用（工事費に対する率）"
              value={consultantRate}
              onChange={setConsultantRate}
              min={0.03}
              max={0.07}
              step={0.005}
              disabled={!designEnabled}
            />
            <Note>
              コンサルタント費用は<strong>工事費の3〜7%程度</strong>が目安です。
              <strong>工事費3,000万円</strong>が分岐点とされ、それを超えると相見積りによる削減効果がコンサル費を上回りやすい一方、
              国交省は「不適切コンサル」問題を注意喚起しています。信頼できる第三者コンサルの選定が前提です。
            </Note>
          </Panel>

          <Panel title="④ 機械式駐車場の見直し">
            <Toggle
              label="機械式駐車場を見直す（平面化・台数削減）"
              checked={parkingEnabled}
              onChange={setParkingEnabled}
            />
            <SliderField
              label="削減率"
              value={parkingRate}
              onChange={setParkingRate}
              min={0}
              max={1}
              step={0.05}
              disabled={!parkingEnabled}
            />
            <Note>機械式駐車場の維持・更新費は高額になりやすく、稼働率が低い場合は平面化・台数削減の効果が大きい手法です。</Note>
          </Panel>

          <Panel title="⑤ 仕様・数量の精査">
            <Toggle
              label="劣化診断に基づき仕様・数量を精査する"
              checked={scopeEnabled}
              onChange={setScopeEnabled}
            />
            <SliderField
              label="削減率"
              value={scopeRate}
              onChange={setScopeRate}
              min={0}
              max={0.1}
              step={0.01}
              disabled={!scopeEnabled}
            />
            <Note>劣化診断の結果に基づき、過剰な仕様・数量を見直すことで数%程度の削減が期待できるとされます（診断精度に依存）。</Note>
          </Panel>

          <p className="text-[11px] text-slate-400">
            出典:{' '}
            <a
              href="https://www.mlit.go.jp/jutakukentiku/house/content/001747006.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-sky-700"
            >
              長期修繕計画作成ガイドライン（国交省・令和6年6月改定）
            </a>
            {' / '}
            <a
              href="https://www.zenkoku-mankan.org/select-2/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-sky-700"
            >
              発注方式の比較（全国マンション管理組合連合会）
            </a>
          </p>
        </aside>

        {/* ===== 右: 結果 ===== */}
        <main className="space-y-4">
          {/* 主要指標: 実質的な削減額を最も目立たせ、見かけの削減額と期間外繰り延べを分離して示す */}
          <div>
            <h2 className="font-semibold text-slate-700 text-sm">削減内訳（試算期間内の総修繕支出）</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              金額は基準年（{priceBaseYear}年）価格です。物価上昇の影響は下の「資金への影響」に反映されます。
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div
              className={`rounded-xl shadow-sm border-2 p-4 lg:col-span-1 ${
                realReduction > 0
                  ? 'bg-emerald-50 border-emerald-300'
                  : realReduction < 0
                  ? 'bg-red-50 border-red-300'
                  : 'bg-slate-50 border-slate-300'
              }`}
            >
              <div className="text-xs font-semibold text-slate-600">実質的な削減額</div>
              <div
                className={`text-2xl font-bold ${
                  realReduction > 0 ? 'text-emerald-700' : realReduction < 0 ? 'text-red-700' : 'text-slate-700'
                }`}
              >
                {realReduction >= 0 ? '▲' : '+'}
                {yen2man(Math.abs(realReduction))}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                （削減前総支出 − 削減後総支出） − 期間外繰り延べ額 ＝ 実質的な削減効果
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3">
              <div className="text-xs text-slate-500">試算期間内の総修繕支出</div>
              <div className="text-lg font-bold text-slate-800">{yen2man(totalRepairAfter)}</div>
              <div className="text-[11px] text-slate-400">
                削減前 {yen2man(totalRepairBefore)} → 差 ▲{yen2man(repairReduction)}
              </div>
            </div>

            {deferredAmount > 0 ? (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-3">
                <div className="text-xs text-amber-800 font-medium">うち 期間外へ繰り延べ</div>
                <div className="text-lg font-bold text-amber-700">{yen2man(deferredAmount)}</div>
                <div className="text-[11px] text-amber-800 mt-1">
                  ※ 支出が無くなったわけではありません。試算期間（〜{endYear}年）の外に出た工事費です。
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3">
                <div className="text-xs text-slate-500">うち 期間外へ繰り延べ</div>
                <div className="text-lg font-bold text-slate-800">0円</div>
                <div className="text-[11px] text-slate-400">繰り延べは発生していません</div>
              </div>
            )}
          </div>

          <Panel title="削減内訳（レバーごとの単独効果）">
            <p className="text-xs text-slate-500 -mt-1">
              金額は基準年（{priceBaseYear}年）価格です。物価上昇の影響は下の「資金への影響」に反映されます。
              <br />
              各レバーを他をOFFにしたまま単独で適用した場合の削減額（現在設定されている率を使用）。
              <strong className="text-amber-700">相互作用があるため、単純合算は下の合計行とは一致しません。</strong>
              修繕周期の延長のみ「期間外繰り延べ」を伴うため、見かけの削減額とは別に実質削減額を示しています。
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <th className="px-2 py-1.5 text-left font-medium border-b border-slate-200">レバー</th>
                    <th className="px-2 py-1.5 text-center font-medium border-b border-slate-200">現在の設定</th>
                    <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">単独削減額（見かけ）</th>
                    <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">うち期間外繰り延べ</th>
                    <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">実質削減額</th>
                  </tr>
                </thead>
                <tbody>
                  {leverBreakdown.map((l) => (
                    <tr key={l.key} className="odd:bg-white even:bg-slate-50">
                      <td className="px-2 py-1.5 border-b border-slate-100 text-slate-700">{l.label}</td>
                      <td className="px-2 py-1.5 border-b border-slate-100 text-center">
                        {l.active ? (
                          <span className="text-emerald-700 font-medium">ON</span>
                        ) : (
                          <span className="text-slate-400">OFF</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 border-b border-slate-100 text-right font-medium text-slate-600">
                        ▲{yen2man(l.amount)}
                      </td>
                      <td className="px-2 py-1.5 border-b border-slate-100 text-right font-medium">
                        {l.deferred > 0 ? (
                          <span className="text-amber-700">{yen2man(l.deferred)}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td
                        className={`px-2 py-1.5 border-b border-slate-100 text-right font-semibold ${
                          l.real > 0 ? 'text-emerald-700' : l.real < 0 ? 'text-red-700' : 'text-slate-500'
                        }`}
                      >
                        {l.real >= 0 ? '▲' : '+'}
                        {yen2man(Math.abs(l.real))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50">
                    <td className="px-2 py-1.5 font-semibold text-slate-700" colSpan={2}>
                      合計（現在の全レバー組み合わせ）
                    </td>
                    <td className="px-2 py-1.5 text-right font-bold text-slate-600">▲{yen2man(repairReduction)}</td>
                    <td className="px-2 py-1.5 text-right font-bold text-amber-700">
                      {deferredAmount > 0 ? yen2man(deferredAmount) : '—'}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right font-bold ${
                        realReduction > 0 ? 'text-emerald-700' : realReduction < 0 ? 'text-red-700' : 'text-slate-600'
                      }`}
                    >
                      {realReduction >= 0 ? '▲' : '+'}
                      {yen2man(Math.abs(realReduction))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <Panel title="大規模修繕スケジュールの比較">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <th className="px-2 py-1.5 text-left font-medium border-b border-slate-200">工事</th>
                    <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">削減前（年・金額）</th>
                    <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">削減後（年・金額）</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.map((row) => (
                    <tr key={row.label} className="odd:bg-white even:bg-slate-50">
                      <td className="px-2 py-1.5 border-b border-slate-100 text-slate-700">{row.label}</td>
                      <td className="px-2 py-1.5 border-b border-slate-100 text-right whitespace-nowrap">
                        {row.beforeYear}年 / {yen2man(row.beforeAmount)}
                      </td>
                      <td className="px-2 py-1.5 border-b border-slate-100 text-right whitespace-nowrap">
                        {row.excluded ? (
                          <span className="text-amber-700 font-medium">計画期間外へ繰り延べ</span>
                        ) : (
                          <>
                            {row.afterYear}年 / {yen2man(row.afterAmount!)}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
              「計画期間外へ繰り延べ」＝修繕周期の延長により試算期間（{baseInput.startYear}〜{endYear}年）を超えた工事。
              <strong>支出が無くなったわけではなく、期間の外に出ただけです。</strong>
            </p>
          </Panel>

          <div>
            <h2 className="font-semibold text-slate-700 text-sm">資金への影響</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              物価上昇率{pct(inflationRate * 100)}を反映した実際の資金繰りへの影響です（すまい・る債運用込み）。
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Kpi
              label="期末総資産の改善"
              value={`${assetImprovement >= 0 ? '+' : ''}${yen2man(assetImprovement)}`}
              sub="削減後 − 削減前（すまい・る債運用込み）"
              accent={assetImprovement >= 0 ? 'good' : 'bad'}
            />
            <Kpi
              label="資金ショート"
              value={resAfter.hasShortfall ? `${resAfter.firstShortfallYear}年` : 'なし'}
              sub={`削減前: ${resBefore.hasShortfall ? `${resBefore.firstShortfallYear}年` : 'なし'}`}
              accent={resAfter.hasShortfall ? 'bad' : 'good'}
            />
            <Kpi
              label="必要な積立引き上げ"
              value={requiredIncreaseAfter > 0 ? `+${requiredIncreaseAfter.toLocaleString()}円/戸月` : '不要'}
              sub={`削減前: ${requiredIncreaseBefore > 0 ? `+${requiredIncreaseBefore.toLocaleString()}円/戸月` : '不要'}`}
              accent={requiredIncreaseAfter < requiredIncreaseBefore ? 'good' : undefined}
            />
          </div>

          <Panel title="残高推移（万円）: 削減前 vs 削減後">
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={56} />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toLocaleString()}万円`, name]}
                  labelFormatter={(l) => `${l}年度`}
                />
                <Legend />
                <Bar dataKey="修繕支出_削減後" fill="#fca5a5" barSize={14} name="修繕支出（削減後）" />
                <Line
                  type="monotone"
                  dataKey="総資産_削減前"
                  stroke="#64748b"
                  strokeDasharray="5 5"
                  dot={false}
                  name="総資産（削減前）"
                />
                <Line
                  type="monotone"
                  dataKey="総資産_削減後"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={false}
                  name="総資産（削減後）"
                />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-xs text-slate-500 mt-2">
              実線（青）＝削減後の総資産、点線（灰）＝削減前の総資産。赤い棒＝削減後の年間修繕支出（物価調整後）。
              すまい・る債60口/年・利率シナリオ「標準」を前提。
            </p>
          </Panel>
        </main>
      </div>
    </div>
  )
}

// ============================================================================
// 小さなUI部品（このページ専用）
// ============================================================================

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <h2 className="font-semibold text-slate-700 mb-3 text-sm">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  disabled?: boolean
}) {
  return (
    <Field label={`${label}: ${pct(value * 100)}`}>
      <input
        type="range"
        min={min * 100}
        max={max * 100}
        step={step * 100}
        value={value * 100}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className={`w-full ${disabled ? 'opacity-40' : ''}`}
      />
    </Field>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 rounded p-2">{children}</p>
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] text-amber-900 leading-relaxed bg-amber-50 border border-amber-300 rounded-lg p-2.5 space-y-1.5">
      {children}
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'good' | 'bad'
}) {
  const color =
    accent === 'good' ? 'text-emerald-600' : accent === 'bad' ? 'text-red-600' : 'text-slate-800'
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
}
