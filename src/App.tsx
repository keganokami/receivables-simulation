import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { simulate, simulateWithoutBond } from './engine/simulate'
import { RATE_SCENARIOS } from './engine/scenarios'
import { GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY, ACCOUNTS } from './engine/geoSaito'
import { AssociationInput, BondStrategy } from './engine/types'
import {
  CSV_TEMPLATES,
  CsvKind,
  downloadText,
  loadCsv,
  parseConfig,
  serializeConfig,
} from './engine/io'
import { yen2man, pct } from './ui/format'
import { findOptimalUnits, requiredMonthlyIncrease, evaluatePlan, PlanEvalResult } from './engine/report'

const CSV_KIND_LABEL: Record<CsvKind, string> = {
  reserveSteps: '段階増額計画',
  repairPlan: '長期修繕計画',
  otherCashflows: 'その他収支',
}

export default function App() {
  const [input, setInput] = useState<AssociationInput>(GEO_SAITO_COMBINED)
  const [strategy, setStrategy] = useState<BondStrategy>(GEO_SAITO_STRATEGY)
  const [scenarioIdx, setScenarioIdx] = useState(1)

  const [ioStatus, setIoStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const scenario = RATE_SCENARIOS[scenarioIdx]

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const loaded: string[] = []
    let nextInput = input
    try {
      for (const file of Array.from(files)) {
        const text = await file.text()
        if (file.name.toLowerCase().endsWith('.json')) {
          const bundle = parseConfig(text)
          nextInput = bundle.input
          setStrategy(bundle.strategy)
          if (typeof bundle.scenarioIdx === 'number') setScenarioIdx(bundle.scenarioIdx)
          loaded.push(`設定JSON（${file.name}）`)
        } else {
          const res = loadCsv(text)
          nextInput = { ...nextInput, ...res.patch }
          loaded.push(`${CSV_KIND_LABEL[res.kind]} ${res.count}件`)
        }
      }
      setInput(nextInput)
      setIoStatus({ ok: true, msg: `読込: ${loaded.join(' / ')}` })
    } catch (e) {
      setIoStatus({ ok: false, msg: `エラー: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function exportConfig() {
    downloadText(
      'simulation_config.json',
      serializeConfig(input, strategy, scenarioIdx),
      'application/json;charset=utf-8'
    )
  }

  const [reportStatus, setReportStatus] = useState<string | null>(null)
  const [reportBusy, setReportBusy] = useState(false)
  async function generateReport() {
    setReportBusy(true)
    setReportStatus('レポートを生成中…（Claude不要・十数秒）。完了するとPDFが自動でダウンロードされます。')
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serializeConfig(input, strategy, scenarioIdx),
      })
      if (!res.ok || !res.headers.get('Content-Type')?.includes('application/pdf')) {
        const j = await res.json().catch(() => ({}))
        setReportStatus(`エラー: ${j.error ?? `生成に失敗しました (HTTP ${res.status})`}`)
        return
      }
      // PDFを受け取り自動ダウンロード
      const blob = await res.blob()
      const fnameHeader = res.headers.get('X-Report-Filename')
      const filename = fnameHeader
        ? decodeURIComponent(fnameHeader)
        : 'ジオ彩都_修繕積立金レポート.pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setReportStatus(`レポート（PDF）をダウンロードしました：${filename}`)
    } catch (e) {
      setReportStatus(
        `エラー: devサーバ経由でのみ利用できます（npm run dev）。${e instanceof Error ? e.message : ''}`
      )
    } finally {
      setReportBusy(false)
    }
  }

  const { withBond, without, chartData } = useMemo(() => {
    const withBond = simulate(input, scenario, strategy)
    const without = simulateWithoutBond(input, scenario)
    const chartData = withBond.rows.map((r, i) => ({
      year: r.year,
      流動資金: Math.round(r.liquidEnd / 10_000),
      すまいる債: Math.round(r.bondHoldings / 10_000),
      総資産: Math.round(r.totalEnd / 10_000),
      運用なし総資産: Math.round((without.rows[i]?.totalEnd ?? 0) / 10_000),
      修繕支出: Math.round(r.repairExpense / 10_000),
      積立金収入: Math.round(r.reserveIncome / 10_000),
      戸あたり月額: Math.round(r.reserveIncome / input.units / 12),
    }))
    return { withBond, without, chartData }
  }, [input, scenario, strategy])

  const boostAnalysis = useMemo(() => {
    if (!input.reserveBoost || input.reserveBoost.addAnnual === 0) return null
    const inputNoBoost = { ...input, reserveBoost: undefined }
    const withBondNoBoost = simulate(inputNoBoost, scenario, strategy)
    return {
      noBoostHasShortfall: withBondNoBoost.hasShortfall,
      endingTotal: withBond.endingTotal,
    }
  }, [input, scenario, strategy, withBond.endingTotal])

  // 実装1: 最適口数・実質上限（再投資モードを反映）
  const optimalInfo = useMemo(
    () => findOptimalUnits(input, scenario, strategy.reissue ?? false),
    [input, scenario, strategy.reissue]
  )

  // すまい・る債 運用プラン比較（3案）
  const bondPlans = useMemo((): PlanEvalResult[] => {
    const STANDARD_UNITS = 60
    const usedUnits = new Set<number>()
    const planDefs: { key: string; name: string; purpose: string; units: number }[] = []
    // 堅実案: maxContinuousUnits=0 の場合（物価高ストレス等）は最小10口をフロアとして使う
    planDefs.push({ key: 'conservative', name: '堅実案', purpose: '無理なく10年継続・中途換金なし', units: Math.max(10, optimalInfo.maxContinuousUnits) })
    usedUnits.add(optimalInfo.maxContinuousUnits)
    // 標準案
    if (!usedUnits.has(STANDARD_UNITS)) {
      planDefs.push({ key: 'standard', name: '標準案', purpose: 'バランス', units: STANDARD_UNITS })
      usedUnits.add(STANDARD_UNITS)
    }
    // 積極案
    if (!usedUnits.has(optimalInfo.optimalUnits)) {
      planDefs.push({ key: 'aggressive', name: '積極案', purpose: 'メリット最大・中途換金前提', units: optimalInfo.optimalUnits })
      usedUnits.add(optimalInfo.optimalUnits)
    }
    planDefs.sort((a, b) => a.units - b.units)
    return planDefs.map((def) => ({
      key: def.key,
      name: def.name,
      purpose: def.purpose,
      ...evaluatePlan(input, scenario, def.units, 10, strategy.reissue ?? false),
    }))
  }, [input, scenario, optimalInfo, strategy.reissue])

  // 実装2: 必要な積立引き上げ（運用あり・なし）
  const requiredIncreaseWithBond = useMemo(
    () => requiredMonthlyIncrease(input, scenario, strategy),
    [input, scenario, strategy]
  )
  const requiredIncreaseNoBond = useMemo(() => {
    const noBondStrategy: BondStrategy = {
      enabled: false,
      startYear: strategy.startYear,
      unitsPerYear: 0,
      purchaseYears: 0,
      allowEarlyRedemption: false,
    }
    return requiredMonthlyIncrease(input, scenario, noBondStrategy)
  }, [input, scenario, strategy])

  // 実装3: 棟別の月額推移データ（年次）
  const perAccountMonthlyData = useMemo(() => {
    const years = Array.from({ length: input.horizonYears }, (_, i) => input.startYear + i)
    // annualOf ヘルパー（geoSaito の内部関数と同等）
    function annualOf(steps: { fromYear: number; annual: number }[], year: number): number {
      let v = 0, best = -Infinity
      for (const s of steps) {
        if (s.fromYear <= year && s.fromYear > best) { best = s.fromYear; v = s.annual }
      }
      return v
    }
    // 積立金の引き上げ（戸あたり月額の上乗せ）を住戸合計に反映
    const boost = input.reserveBoost
    const boostPUM = boost && boost.addAnnual ? Math.round(boost.addAnnual / input.units / 12) : 0
    const boostFrom = boost?.fromYear ?? Infinity
    return years.map((year) => {
      const danchi = ACCOUNTS[0] // 団地
      const abc = ACCOUNTS[1]    // ABC棟
      const de = ACCOUNTS[2]     // DE棟
      const danchiPerUnit = Math.round(annualOf(danchi.reserveAnnualSteps, year) / danchi.units / 12)
      const abcPerUnit = Math.round(annualOf(abc.reserveAnnualSteps, year) / abc.units / 12)
      const dePerUnit = Math.round(annualOf(de.reserveAnnualSteps, year) / de.units / 12)
      const uplift = year >= boostFrom ? boostPUM : 0 // 引き上げ分（戸あたり月額）
      return {
        year,
        団地会計: danchiPerUnit,
        'ABC棟': abcPerUnit,
        'DE棟': dePerUnit,
        'ABC住戸合計': abcPerUnit + danchiPerUnit + uplift,
        'DE住戸合計': dePerUnit + danchiPerUnit + uplift,
      }
    })
  }, [input])

  const benefit = withBond.endingTotal - without.endingTotal

  // 前提として読み込んでいる実データ（表示用）
  const currentAnnualReserve = (() => {
    const steps = input.reserveAnnualSteps ?? []
    let v = 0
    let best = -Infinity
    for (const s of steps) {
      if (s.fromYear <= input.startYear && s.fromYear > best) {
        best = s.fromYear
        v = s.annual
      }
    }
    return v
  })()
  const bigWorks = input.repairPlan
    .filter((r) => r.amount >= 50_000_000)
    .sort((a, b) => a.year - b.year)

  function resetToRealData() {
    setInput(GEO_SAITO_COMBINED)
    setStrategy(GEO_SAITO_STRATEGY)
    setScenarioIdx(1)
  }

  // 積立金の引き上げシミュレーション（戸あたり月額の定額上乗せ）
  const boostFromYear = input.reserveBoost?.fromYear ?? 2028
  const boostPerUnitMonth = input.reserveBoost
    ? Math.round(input.reserveBoost.addAnnual / input.units / 12)
    : 0
  const boostAddAnnual = boostPerUnitMonth * input.units * 12
  function setBoost(fromYear: number, perUnitMonth: number) {
    setInput({
      ...input,
      reserveBoost:
        perUnitMonth > 0 ? { fromYear, addAnnual: perUnitMonth * input.units * 12 } : undefined,
    })
  }

  // 戸あたり平均月額（円/月）の推移レンジ（実感しやすい指標）
  const steps = input.reserveAnnualSteps ?? []
  const perUnitMonthOf = (annual: number) => Math.round(annual / input.units / 12)
  const firstPUM = steps.length ? perUnitMonthOf(steps[0].annual) : 0
  const lastPUM = steps.length ? perUnitMonthOf(steps[steps.length - 1].annual) : 0

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-slate-800 text-white px-6 py-4 shadow">
        <h1 className="text-xl font-bold">修繕積立金シミュレーター</h1>
        <p className="text-sm text-slate-300">
          長期修繕計画にもとづくキャッシュフローと、すまい・る債運用の効果を試算します
        </p>
      </header>

      <div className="max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* ===== 操作パネル ===== */}
        <aside className="space-y-5">
          <Panel title="前提条件">
            <button
              className="w-full border border-slate-300 hover:bg-slate-50 rounded-md py-1.5 text-xs text-slate-600"
              onClick={resetToRealData}
            >
              ↺ 実データ（ジオ彩都・372戸）に戻す
            </button>
            <Field label="管理組合名">
              <input
                className="input"
                value={input.name}
                onChange={(e) => setInput({ ...input, name: e.target.value })}
              />
            </Field>
            <Field label="全戸数（固定）">
              <div className="input bg-slate-50 text-slate-600">{input.units} 戸</div>
            </Field>
            <NumField
              label="開始時の積立金残高（円）"
              value={input.openingBalance}
              step={1_000_000}
              onChange={(v) => setInput({ ...input, openingBalance: v })}
            />
            <Field label={`修繕費の物価上昇率: ${pct(input.inflationRate * 100)}/年`}>
              <input
                type="range"
                min={0}
                max={4}
                step={0.1}
                value={input.inflationRate * 100}
                onChange={(e) =>
                  setInput({ ...input, inflationRate: Number(e.target.value) / 100 })
                }
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
                      Math.abs(input.inflationRate * 100 - p.v) < 0.05
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'border-slate-300 hover:bg-slate-50'
                    }`}
                    onClick={() => setInput({ ...input, inflationRate: p.v / 100 })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 space-y-0.5">
                <div><strong>目安（建設工事費の実績）:</strong></div>
                <div>・<strong>0%</strong>＝計画書のまま（物価変動を見込まない）</div>
                <div>・<strong>1〜2%</strong>＝穏やかな上昇（長期計画の一般的な前提）</div>
                <div>・<strong>約2.6%</strong>＝建設工事費デフレーターの過去10年平均（10年で約3割上昇）</div>
                <div>・<strong>3%以上</strong>＝資材・人件費の高騰局面（2021-22年は前年比10%超の月も／労務単価は12年連続上昇＝年約4%）</div>
                <div className="text-slate-400">出典: 国交省 建設工事費デフレーター・公共工事設計労務単価</div>
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={input.isCertified}
                onChange={(e) => setInput({ ...input, isCertified: e.target.checked })}
              />
              管理計画認定マンション（利率優遇）
            </label>
          </Panel>

          <Panel title="読み込み済みの実データ（前提）">
            <div className="text-xs space-y-1">
              <InfoRow
                label="今年度の修繕積立金収入"
                value={`${yen2man(currentAnnualReserve)}/年`}
              />
              <div className="pt-1 text-slate-500">修繕積立金 残高の内訳（第2期末）:</div>
              {ACCOUNTS.map((a) => (
                <InfoRow key={a.key} label={a.name} value={yen2man(a.openingBalance)} />
              ))}
              <InfoRow label="合計" value={yen2man(input.openingBalance)} bold />
              <div className="pt-1 text-slate-500">段階増額（円/㎡・月・5年ごとに定額改定）:</div>
              {ACCOUNTS.map((a) => (
                <InfoRow
                  key={a.key}
                  label={a.name}
                  value={a.reserveAnnualSteps.map((s) => Math.round(s.annual / a.senyuArea / 12)).join(' → ')}
                />
              ))}
              <p className="text-[11px] text-slate-400">
                改定年: 団地・ABC棟=2028/33/38/43年、DE棟=2029/34/39/44年
              </p>
              <InfoRow
                label="戸あたり平均月額（棟＋団地）"
                value={`約${firstPUM.toLocaleString()} → ${lastPUM.toLocaleString()}円/月`}
                bold
              />
              <p className="text-[11px] text-slate-400">
                一般的な目安（国交省ガイドライン・延床2万㎡超/20階未満）: 約255円/㎡・月
                ＝ 75㎡なら約1.9万円/月（機械式駐車場は別途加算）。本物件は最終的に棟＋団地で
                約300円/㎡・月に達し、概ね一般的な水準です。
              </p>
              <div className="pt-1 text-slate-500">主な大規模修繕（計画額）:</div>
              {bigWorks.map((w) => (
                <InfoRow key={`${w.year}-${w.label}`} label={`${w.year}年 ${w.label}`} value={yen2man(w.amount)} />
              ))}
            </div>
            <p className="text-[11px] text-slate-400 pt-1">
              出典: 収支報告書(第1・2期)・長期修繕計画書(団地/ABC/DE)。数値は左の入力・CSV読込で変更できます。
            </p>
          </Panel>

          <Panel title="利率シナリオ（金利情勢）">
            <select
              className="input"
              value={scenarioIdx}
              onChange={(e) => setScenarioIdx(Number(e.target.value))}
            >
              {RATE_SCENARIOS.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-2">{scenario.description}</p>
          </Panel>

          <Panel title="すまい・る債の運用">
            <label className="flex items-center gap-2 text-sm mb-2">
              <input
                type="checkbox"
                checked={strategy.enabled}
                onChange={(e) => setStrategy({ ...strategy, enabled: e.target.checked })}
              />
              すまい・る債で運用する
            </label>
            <NumField
              label="毎年の購入口数（1口=50万円）"
              value={strategy.unitsPerYear}
              onChange={(v) => setStrategy({ ...strategy, unitsPerYear: v })}
            />
            <p className="text-xs text-slate-500 -mt-2">
              = 年 {yen2man(strategy.unitsPerYear * 500_000)} の積立
            </p>
            <NumField
              label="購入開始年度（西暦）"
              value={strategy.startYear}
              onChange={(v) => setStrategy({ ...strategy, startYear: v })}
            />
            <NumField
              label="継続購入年数（最大10）"
              value={strategy.purchaseYears}
              onChange={(v) =>
                setStrategy({ ...strategy, purchaseYears: Math.min(10, Math.max(0, v)) })
              }
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={strategy.allowEarlyRedemption}
                onChange={(e) =>
                  setStrategy({ ...strategy, allowEarlyRedemption: e.target.checked })
                }
              />
              資金不足時は中途換金して充当
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={strategy.reissue ?? false}
                onChange={(e) => setStrategy({ ...strategy, reissue: e.target.checked })}
              />
              <span>
                満期後も新規発行を継続（再投資・その先のIF）
                <span className="block text-[11px] text-slate-500">
                  {strategy.reissue
                    ? '10年満期→再応募を繰り返し、30年を通じて運用し続ける想定。'
                    : 'OFF＝開始から最大10回の単発。10年サイクル後は債券が満期で無くなります。'}
                </span>
              </span>
            </label>
            {/* 最適口数・継続上限の表示 */}
            <div className="mt-2 p-2 bg-sky-50 border border-sky-200 rounded text-xs space-y-1">
              <div className="text-sky-800 font-medium">
                この物件の口数の目安（自動試算）
                {(strategy.reissue ?? false) && (
                  <span className="ml-1 text-sky-600 font-normal">再投資モード：満期後も継続発行の前提</span>
                )}
              </div>
              <InfoRow
                label="メリット最大（積極策）"
                value={`約${optimalInfo.optimalUnits}口/年（+${yen2man(optimalInfo.optimalBenefit)}）`}
              />
              <InfoRow
                label="無理なく10年継続（中途換金なし）"
                value={`約${optimalInfo.maxContinuousUnits}口/年`}
              />
              <p className="text-[11px] text-sky-700/80">
                口数を増やすほどメリットは伸びますが、約{optimalInfo.optimalUnits}口でピーク。
                それを超えると継続購入が早期に打ち切られメリットが下がります。
                {optimalInfo.maxContinuousUnits}口までなら中途換金なしで10年間フル継続できます。
              </p>
            </div>
            {strategy.enabled && strategy.unitsPerYear > optimalInfo.optimalUnits && (
              <div className="p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-800">
                ⚠️ 現在の{strategy.unitsPerYear}口/年は最適（約{optimalInfo.optimalUnits}口）を超えています。
                継続購入が早期に打ち切られ、かえってメリットが下がります。
              </div>
            )}
          </Panel>

          <Panel title="積立金の引き上げシミュレーション">
            <p className="text-xs text-slate-500 -mt-1">
              段階増額計画に「戸あたり月額の定額上乗せ」をして、資金不足を避けるのに必要な増額を試算します。
            </p>
            <Field label="引き上げ開始年度">
              <select
                className="input"
                value={boostFromYear}
                onChange={(e) => setBoost(Number(e.target.value), boostPerUnitMonth)}
              >
                <option value={2026}>2026年（今すぐ）</option>
                <option value={2028}>2028年（次の改定）</option>
                <option value={2033}>2033年</option>
                <option value={2038}>2038年</option>
              </select>
            </Field>
            <Field label="上乗せ額（戸あたり月額）">
              <select
                className="input"
                value={boostPerUnitMonth}
                onChange={(e) => setBoost(boostFromYear, Number(e.target.value))}
              >
                <option value={0}>+0円/月（現行のまま）</option>
                <option value={1000}>+1,000円/月</option>
                <option value={2000}>+2,000円/月</option>
                <option value={3000}>+3,000円/月</option>
                <option value={5000}>+5,000円/月</option>
                <option value={8000}>+8,000円/月</option>
              </select>
            </Field>
            {boostPerUnitMonth > 0 ? (
              <p className="text-xs text-slate-600">
                {boostFromYear}年以降、全戸で <strong>+{boostPerUnitMonth.toLocaleString()}円/月</strong> 上乗せ
                → 管理組合全体で 年間 <strong>+{yen2man(boostAddAnnual)}</strong>。
                {withBond.hasShortfall ? (
                  <span className="text-red-600">まだ{withBond.firstShortfallYear}年に不足あり。</span>
                ) : (
                  <span className="text-emerald-600">資金ショートは解消。</span>
                )}
              </p>
            ) : (
              <p className="text-xs text-slate-400">現行の段階増額計画のまま（上乗せなし）。</p>
            )}
            {boostPerUnitMonth > 0 && (() => {
              const endYear = input.startYear + input.horizonYears - 1
              const boostYears = endYear - (input.reserveBoost?.fromYear ?? input.startYear) + 1
              const totalExtra = boostAddAnnual * Math.max(0, boostYears)
              const surplus = withBond.endingTotal
              return (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>30年間の追加徴収額合計</span>
                    <strong>{yen2man(totalExtra)}</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>期末の余剰（総資産）</span>
                    <strong>{yen2man(surplus)}</strong>
                  </div>
                  {boostAnalysis && !boostAnalysis.noBoostHasShortfall ? (
                    <div className="mt-1 p-2 bg-red-50 border border-red-200 rounded text-red-700">
                      ⚠️ この増額は資金不足の回避には不要です。期末に <strong>{yen2man(surplus)}</strong> が余剰として残ります（住民の払い過ぎの可能性）。
                    </div>
                  ) : boostAnalysis && boostAnalysis.noBoostHasShortfall && !withBond.hasShortfall ? (
                    <div className="mt-1 p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-700">
                      ✅ この増額により資金ショートが解消されます。
                    </div>
                  ) : null}
                </div>
              )
            })()}
          </Panel>

          <Panel title="データ入出力">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <button
              className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-md py-2 text-sm font-medium"
              onClick={() => fileRef.current?.click()}
            >
              CSV / JSON を読み込む
            </button>
            <p className="text-xs text-slate-500">
              長期修繕計画・段階増額計画・その他収支のCSV、または保存した設定JSONを選択（複数可）。
            </p>
            {ioStatus && (
              <p className={`text-xs ${ioStatus.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                {ioStatus.msg}
              </p>
            )}

            <button
              className="w-full border border-slate-300 hover:bg-slate-50 rounded-md py-2 text-sm"
              onClick={exportConfig}
            >
              現在の設定をJSONで書き出す
            </button>

            {import.meta.env.DEV ? (
              <>
                <button
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-md py-2 text-sm font-medium"
                  onClick={generateReport}
                  disabled={reportBusy}
                >
                  {reportBusy ? '生成中…' : '📄 レポート出力（PDF）'}
                </button>
                <p className="text-xs text-slate-500 -mt-1">
                  現在の設定でPDFレポートを生成し、自動でダウンロードします（ローカルのdevサーバ限定）。
                </p>
                {reportStatus && <p className="text-xs text-emerald-700">{reportStatus}</p>}
              </>
            ) : (
              <p className="text-xs text-slate-400">
                📄 PDFレポート出力は、ローカル環境（<code>npm run dev</code>）でのみ利用できます。
                この公開版では、画面上のシミュレーションと「設定をJSONで書き出す」をご利用ください。
              </p>
            )}

            <div className="pt-1">
              <p className="text-xs text-slate-500 mb-1">記入用テンプレート（CSV）:</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(CSV_TEMPLATES) as CsvKind[]).map((k) => (
                  <button
                    key={k}
                    className="text-xs border border-slate-300 hover:bg-slate-50 rounded px-2 py-1"
                    onClick={() => downloadText(CSV_TEMPLATES[k].filename, CSV_TEMPLATES[k].content)}
                  >
                    {CSV_KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        </aside>

        {/* ===== 結果 ===== */}
        <main className="space-y-6">
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              label="期末 総資産"
              value={yen2man(withBond.endingTotal)}
              sub={`${input.startYear + input.horizonYears - 1}年度末`}
            />
            <Kpi label="累計 受取利息" value={yen2man(withBond.totalInterest)} sub="債券＋預金" />
            <Kpi
              label="運用メリット"
              value={yen2man(benefit)}
              sub="運用あり − 運用なし"
              accent={benefit >= 0 ? 'good' : 'bad'}
            />
            <Kpi
              label="資金ショート"
              value={withBond.hasShortfall ? `${withBond.firstShortfallYear}年` : 'なし'}
              sub={withBond.hasShortfall ? '要対策' : '計画は健全'}
              accent={withBond.hasShortfall ? 'bad' : 'good'}
            />
          </div>

          {withBond.hasShortfall && (
            <div className="bg-red-50 border border-red-300 text-red-800 rounded-lg p-3 text-sm">
              ⚠️ {withBond.firstShortfallYear}年度に資金が不足します。積立額（口数・月額）の引き上げ、
              または修繕計画の見直しを検討してください。
            </div>
          )}

          {/* 実装2: 運用メリット vs 必要な積立引き上げ */}
          <Panel title="すまい・る債の補助効果：「月○○円/戸の節約」">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                <div className="text-xs text-emerald-700 mb-1 font-medium">すまい・る債の運用メリット</div>
                <div className="text-xl font-bold text-emerald-700">{benefit >= 0 ? '+' : ''}{yen2man(benefit)}</div>
                <div className="text-xs text-emerald-600 mt-1">
                  現在の{strategy.enabled ? `${strategy.unitsPerYear}口/年` : '運用なし'}・30年間
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-600 mb-1 font-medium">資金ショート解消に必要な積立引き上げ</div>
                {requiredIncreaseNoBond === 0 && requiredIncreaseWithBond === 0 ? (
                  <div className="text-sm text-emerald-600 font-medium">ショートなし（引き上げ不要）</div>
                ) : (
                  <>
                    <div className="text-xs space-y-1 mt-1">
                      <div className="flex justify-between">
                        <span className="text-slate-500">運用なし</span>
                        <span className="font-semibold text-red-700">
                          +{requiredIncreaseNoBond.toLocaleString()}円/戸月
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">現在の運用</span>
                        <span className="font-semibold text-emerald-700">
                          +{requiredIncreaseWithBond.toLocaleString()}円/戸月
                        </span>
                      </div>
                      {requiredIncreaseNoBond > requiredIncreaseWithBond && (
                        <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
                          <span className="text-slate-600 font-medium">運用による節約</span>
                          <span className="font-bold text-sky-700">
                            ▲{(requiredIncreaseNoBond - requiredIncreaseWithBond).toLocaleString()}円/戸月
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-2">
                      運用は積立引き上げを{(requiredIncreaseNoBond - requiredIncreaseWithBond).toLocaleString()}円/戸月ぶん節約する道具。
                      物価上昇率を上げると必要引き上げ額が増えます。
                    </div>
                  </>
                )}
              </div>
            </div>
          </Panel>

          {/* すまい・る債 運用プラン比較（3案） */}
          <Panel title="すまい・る債 運用プラン比較（堅実／標準／積極）">
            <p className="text-xs text-slate-500 -mt-1">
              継続購入の3案を並べて比較します。口数は毎年同一（制度ルール）で最大10年継続。自分の判断で案を選んで左パネルの口数に反映できます。
            </p>
            {(strategy.reissue ?? false) && (
              <p className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded px-2 py-1">
                再投資モード ON：満期後も新規発行を継続する前提で試算しています。
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <th className="px-2 py-1.5 text-left font-medium border-b border-slate-200">プラン</th>
                    <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">口数/年（年額）</th>
                    <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">継続年数</th>
                    <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">累計購入額</th>
                    <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">運用メリット</th>
                    <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">最低残高（年）</th>
                    <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">資金ショート</th>
                  </tr>
                </thead>
                <tbody>
                  {bondPlans.map((plan) => {
                    const isCurrent = strategy.enabled && strategy.unitsPerYear === plan.unitsPerYear
                    return (
                      <tr key={plan.key} className={isCurrent ? 'bg-cyan-50' : 'odd:bg-white even:bg-slate-50'}>
                        <td className={`px-2 py-1.5 border-b border-slate-100 ${isCurrent ? 'font-bold text-cyan-800' : 'font-medium text-slate-700'}`}>
                          {plan.name}{isCurrent ? ' ★' : ''}
                          <div className="text-[10px] font-normal text-slate-400">{plan.purpose}</div>
                        </td>
                        <td className="px-2 py-1 text-right border-b border-slate-100 whitespace-nowrap">
                          {plan.unitsPerYear}口/年
                          <div className="text-[10px] text-slate-400">{yen2man(plan.yenPerYear)}</div>
                        </td>
                        <td className={`px-2 py-1 text-right border-b border-slate-100 whitespace-nowrap ${plan.actualPurchaseYears < 10 ? 'text-amber-700 font-semibold' : 'text-emerald-700'}`}>
                          {plan.actualPurchaseYears}年
                        </td>
                        <td className="px-2 py-1 text-right border-b border-slate-100 whitespace-nowrap">
                          {yen2man(plan.cumulativePurchased)}
                        </td>
                        <td className={`px-2 py-1 text-right border-b border-slate-100 whitespace-nowrap font-semibold ${plan.benefit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          +{yen2man(plan.benefit)}
                        </td>
                        <td className="px-2 py-1 text-right border-b border-slate-100 whitespace-nowrap text-slate-600">
                          {yen2man(plan.minBalance.value)}
                          <span className="text-[10px] text-slate-400">（{plan.minBalance.year}年）</span>
                        </td>
                        <td className={`px-2 py-1 text-right border-b border-slate-100 whitespace-nowrap ${plan.shortfallYear ? 'text-red-600 font-semibold' : 'text-emerald-700'}`}>
                          {plan.shortfallYear ? `${plan.shortfallYear}年` : 'なし'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 p-2 bg-sky-50 border border-sky-200 rounded text-xs text-sky-800 space-y-1">
              <p className="font-medium">制度の要点</p>
              <p>1口50万円・継続は同一口数（変更は新規応募）・購入上限＝年間積立金収入＋前年度末残高（この物件で約2.2億）・発行1年後から手数料なしで中途換金可。</p>
              <p>継続購入の方が一括の大口購入より累計利息が大きくなります（お金が働き続けるため）。積極案は運用メリット最大ですが資金繰りがタイトで中途換金を前提とします。堅実案は中途換金なしで10年フル継続できる上限口数です。</p>
            </div>
          </Panel>

          {/* チャート */}
          <Panel title="資産推移（万円）">
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={56} />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toLocaleString()}万円`, name]}
                  labelFormatter={(l) => `${l}年度`}
                />
                <Legend />
                <Bar dataKey="修繕支出" fill="#f87171" barSize={14} />
                <Area
                  type="monotone"
                  dataKey="すまいる債"
                  stackId="a"
                  stroke="#0ea5e9"
                  fill="#bae6fd"
                />
                <Area
                  type="monotone"
                  dataKey="流動資金"
                  stackId="a"
                  stroke="#10b981"
                  fill="#bbf7d0"
                />
                <Line
                  type="monotone"
                  dataKey="運用なし総資産"
                  stroke="#64748b"
                  strokeDasharray="5 5"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-xs text-slate-500 mt-2">
              積み上げ面＝運用ありの総資産（債券＋流動資金）。点線＝運用なし（全額預金）の総資産。
              赤い棒＝その年の修繕支出。
            </p>
          </Panel>

          {/* 修繕積立金 戸あたり平均月額の推移（段階増額） */}
          <Panel title="修繕積立金 戸あたり平均月額の推移（円/月）">
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={56} />
                <Tooltip
                  formatter={(v: number) => [`${v.toLocaleString()}円/月`, '戸あたり平均月額']}
                  labelFormatter={(l) => `${l}年度`}
                />
                <Bar dataKey="戸あたり月額" fill="#6366f1" />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-xs text-slate-500 mt-2">
              段階増額計画による「1戸あたり平均の月額」の推移（5年ごとに定額改定）。約{firstPUM.toLocaleString()}円/月 →
              約{lastPUM.toLocaleString()}円/月。
              {boostPerUnitMonth > 0
                ? `「積立金の引き上げ」で ${boostFromYear}年以降 +${boostPerUnitMonth.toLocaleString()}円/月 を上乗せ中。`
                : '左パネルの「積立金の引き上げ」で増額を試せます。'}
            </p>
          </Panel>

          {/* 実装3: 棟別の毎月の修繕積立金 */}
          <Panel title="棟別の毎月の修繕積立金（戸あたり平均・円/月）">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={perAccountMonthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={60} />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toLocaleString()}円/月`, name]}
                  labelFormatter={(l) => `${l}年度`}
                />
                <Legend />
                <Line type="stepAfter" dataKey="ABC住戸合計" stroke="#6366f1" strokeWidth={2} dot={false} name="ABC住戸合計（ABC棟+団地）" />
                <Line type="stepAfter" dataKey="DE住戸合計" stroke="#f59e0b" strokeWidth={2} dot={false} name="DE住戸合計（DE棟+団地）" />
                <Line type="stepAfter" dataKey="団地会計" stroke="#10b981" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Line type="stepAfter" dataKey="ABC棟" stroke="#818cf8" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Line type="stepAfter" dataKey="DE棟" stroke="#fbbf24" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-xs text-slate-500 mt-2">
              太線＝住戸が実際に払う合計（棟別会計＋団地会計）。細い破線＝各会計の棟別・団地単体。
              棟別会計（ABC棟・DE棟）は各棟の修繕にのみ使用でき、団地会計は全372戸共通の共用設備（外構・機械式駐車場等）に使用。
              DE棟は大規模修繕が2年遅れ（2035年）かつ設備更新が多く、最終的にABC棟より高くなります。
              {boostPerUnitMonth > 0 && `（「積立金の引き上げ」+${boostPerUnitMonth.toLocaleString()}円/月は${boostFromYear}年以降 住戸合計に反映）`}
            </p>
          </Panel>

          {/* 大規模修繕・大型支出の予定 */}
          <Panel title="大規模修繕・大型支出の予定">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={56} />
                <Tooltip
                  formatter={(v: number) => [`${v.toLocaleString()}万円`, '修繕支出（物価調整後）']}
                  labelFormatter={(l) => `${l}年度`}
                />
                <Bar dataKey="修繕支出" fill="#ef4444" barSize={18}
                  label={{ position: 'top', fontSize: 10, formatter: (v: number) => v >= 5000 ? `${v.toLocaleString()}` : '' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
            {(() => {
              const bigRows = withBond.rows
                .filter(r => r.repairExpense >= 50_000_000)
                .map(r => {
                  const labels = input.repairPlan
                    .filter(p => p.year === r.year)
                    .map(p => p.label)
                    .join(' / ')
                  return { year: r.year, expense: r.repairExpense, labels }
                })
              if (bigRows.length === 0) return <p className="text-xs text-slate-400">5,000万円以上の大型支出は計画期間内にありません。</p>
              return (
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600">
                        <th className="px-2 py-1 text-left font-medium border-b border-slate-200">年度</th>
                        <th className="px-2 py-1 text-left font-medium border-b border-slate-200">内容</th>
                        <th className="px-2 py-1 text-right font-medium border-b border-slate-200">金額（物価調整後）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bigRows.map(row => (
                        <tr key={row.year} className="odd:bg-white even:bg-slate-50">
                          <td className="px-2 py-1 font-medium text-red-700 whitespace-nowrap">{row.year}年</td>
                          <td className="px-2 py-1 text-slate-600">{row.labels}</td>
                          <td className="px-2 py-1 text-right font-medium text-red-700 whitespace-nowrap">{yen2man(row.expense)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
            <p className="text-xs text-slate-500 mt-2">
              棒グラフは各年度の修繕支出合計（物価上昇率スライダー反映後）。表は5,000万円以上の大型工事一覧。
            </p>
          </Panel>

          {/* 年次テーブル */}
          <Panel title="年次キャッシュフロー">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <Th>年度</Th>
                    <Th>築</Th>
                    <Th>積立金収入</Th>
                    <Th>債券利息</Th>
                    <Th>修繕支出</Th>
                    <Th>債券購入</Th>
                    <Th>満期償還</Th>
                    <Th>債券残高</Th>
                    <Th>流動資金</Th>
                    <Th>総資産</Th>
                  </tr>
                </thead>
                <tbody>
                  {withBond.rows.map((r) => (
                    <tr
                      key={r.year}
                      className={r.shortfall ? 'bg-red-50' : 'odd:bg-white even:bg-slate-50'}
                    >
                      <Td>{r.year}</Td>
                      <Td>{r.buildingAge}</Td>
                      <Td>{yen2man(r.reserveIncome)}</Td>
                      <Td>{yen2man(r.bondInterest)}</Td>
                      <Td className={r.repairExpense > 0 ? 'text-red-600 font-medium' : ''}>
                        {r.repairExpense > 0 ? yen2man(r.repairExpense) : '—'}
                      </Td>
                      <Td>{r.bondPurchase > 0 ? yen2man(r.bondPurchase) : '—'}</Td>
                      <Td>{r.maturedPrincipal > 0 ? yen2man(r.maturedPrincipal) : '—'}</Td>
                      <Td>{yen2man(r.bondHoldings)}</Td>
                      <Td className={r.liquidEnd < 0 ? 'text-red-600 font-bold' : ''}>
                        {yen2man(r.liquidEnd)}
                      </Td>
                      <Td className="font-medium">{yen2man(r.totalEnd)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              ※ 金額は万円表示（端数四捨五入）。赤行＝資金ショート年。
            </p>
          </Panel>

          <p className="text-xs text-slate-400">
            利率の前提：{scenario.name}（{pct(scenario.bondRatesByYear[input.startYear] ?? 0)}〜・
            預金 {pct(scenario.depositRate)}）。すまい・る債の利率は毎年度 住宅金融支援機構が決定します。
            本ツールは検討用の概算であり、実際の運用・利息を保証するものではありません。
          </p>
        </main>
      </div>

      <style>{`
        .input { width:100%; border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; font-size:14px; }
        .input:focus { outline:2px solid #0ea5e9; border-color:#0ea5e9; }
      `}</style>
    </div>
  )
}

// ============================================================================
// 小さなUI部品
// ============================================================================

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <h2 className="font-semibold text-slate-700 mb-3 text-sm">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function InfoRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-semibold text-slate-700' : ''}`}>
      <span className="text-slate-500 truncate">{label}</span>
      <span className="whitespace-nowrap tabular-nums">{value}</span>
    </div>
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

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
}) {
  // 編集中は空文字を許可し、確定した数値のみ親へ通知（0に張り付いて入力できない問題を回避）
  const [text, setText] = useState(String(value))
  useEffect(() => {
    // 外部で値が変わったとき（実データに戻す等）だけ同期。編集中の一致は上書きしない。
    if (Number(text) !== value) setText(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <Field label={label}>
      <input
        type="number"
        className="input"
        value={text}
        step={step}
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) {
            onChange(Number(e.target.value))
          }
        }}
        onBlur={() => {
          if (text === '' || !Number.isFinite(Number(text))) {
            setText('0')
            onChange(0)
          }
        }}
      />
    </Field>
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

function Th({ children }: { children: ReactNode }) {
  return <th className="px-2 py-1.5 text-right font-medium border-b border-slate-200">{children}</th>
}

function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-2 py-1 text-right whitespace-nowrap ${className}`}>{children}</td>
}
