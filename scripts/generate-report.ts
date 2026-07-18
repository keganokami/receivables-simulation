/*
 * 修繕積立金シミュレーション レポート生成
 *
 * 使い方:
 *   npm run report                       … 既定（ジオ彩都・標準シナリオ）でPDF生成
 *   npm run report -- --config <file>    … アプリが書き出した設定JSONを反映
 *   npm run report -- --open             … 生成後にPDFを開く
 *
 * 流れ: エンジンで数値を確定 → claude -p で最新の利率・金利情勢の所見を取得
 *       → HTML組み立て → ヘッドレスChromeでPDF化。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildReportData, ReportData, PlanEvalResult } from '../src/engine/report'
import { GEO_SAITO_COMBINED, GEO_SAITO_STRATEGY } from '../src/engine/geoSaito'
import { AssociationInput, BondStrategy } from '../src/engine/types'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// ---- 引数 ----
const args = process.argv.slice(2)
function argVal(name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const configPath = argVal('--config')
const doOpen = args.includes('--open')
// 既定は Claude を使わない即ローカル生成。--claude で最新の利率・金利情勢をWeb取得（将来のデプロイ時に本格対応）
const useClaude = args.includes('--claude')

// ---- 設定の読み込み ----
let input: AssociationInput = GEO_SAITO_COMBINED
let strategy: BondStrategy = GEO_SAITO_STRATEGY
let scenarioIdx = 1
if (configPath && existsSync(configPath)) {
  try {
    const b = JSON.parse(readFileSync(configPath, 'utf8'))
    if (b.input) input = b.input
    if (b.strategy) strategy = b.strategy
    if (typeof b.scenarioIdx === 'number') scenarioIdx = b.scenarioIdx
    console.log(`設定を読み込みました: ${configPath}`)
  } catch (e) {
    console.warn('設定の読み込みに失敗。既定値を使用します。', e)
  }
}

const data = buildReportData(input, strategy, scenarioIdx)

// ---- フォーマッタ ----
const oku = (n: number) => `${(n / 1e8).toFixed(2)}億円`
const man = (n: number) => `${Math.round(n / 1e4).toLocaleString('ja-JP')}万円`
const pct = (n: number) => `${n.toLocaleString('ja-JP', { maximumFractionDigits: 3 })}%`
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))

const today = new Date()
const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`
const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

// ---- 静的な所見（Claude不要・選択シナリオの利率で記述）----
function staticCommentary(d: ReportData): string {
  const bondRate = d.comparison[0]?.bondRateStart ?? 0
  const depositRate = d.comparison[0]?.depositRate ?? 0
  return `<h3>利率・金利情勢の前提</h3>
<p>本レポートは「${esc(d.meta.scenarioName)}」シナリオ（すまい・る債 ${pct(bondRate)}〜／預金 ${pct(depositRate)}）を前提に試算しています。すまい・る債の利率は毎年度、住宅金融支援機構が決定します（2025年度は0.525%でしたが、金利上昇局面では大きく変動します）。<strong>最新年度の実際の利率は公式サイトでご確認のうえ、シナリオを合わせてください。</strong></p>
<p>すまい・る債は発行から1年経過後は手数料なしで中途換金でき、10年満期前でも大規模修繕等に取り崩せます。眠っている修繕積立金を継続的に振り向けることで、無理なく利息収入を積み上げられます。ただし本シミュレーションが示すとおり、運用益は必要な積立引き上げを月数百円ぶん軽減する補助的な効果であり、物価上昇による不足を埋める主たる手段は積立金の適正な引き上げです。</p>
<p style="color:#94a3b8;font-size:11px">※ 最新の利率・金利情勢の自動反映（Web取得）は将来のデプロイ時に対応予定。現状は選択シナリオの前提値で記載しています（<code>--claude</code> オプションで最新取得も可能）。</p>`
}

// ---- Claude で最新の利率・金利情勢の所見を取得（--claude 時のみ。失敗時は静的所見にフォールバック）----
function claudeCommentary(d: ReportData): string {
  const facts = [
    `対象: ${d.meta.name}（${d.meta.units}戸）`,
    `現在の修繕積立金残高: ${oku(d.meta.openingBalance)}`,
    `第1回大規模修繕: 2034年 ABC棟 / 2035年 DE棟（各棟 経年12）`,
    `棟別の最低残高(運用なし): ${d.perAccount.map((a) => `${a.name} ${oku(a.minBalance.value)}(${a.minBalance.year})`).join(' / ')}`,
    `すまい・る債 運用メリット(30年・${d.meta.scenarioName}): ${d.comparison[0].rows.find((r) => r.unitsPerYear === 80)?.benefit != null ? man(d.comparison[0].rows.find((r) => r.unitsPerYear === 80)!.benefit) : '試算値あり'}`,
  ].join('\n')

  const prompt = `あなたはマンション管理組合向けのファイナンシャル・アドバイザーです。
以下はある団地型マンションの修繕積立金シミュレーション結果です。

${facts}

本日（${dateStr}）時点で判明している最新情報をふまえ、管理組合の理事会向けレポートに載せる「所見」を書いてください。必ず含めること:
1. 住宅金融支援機構「マンションすまい・る債」の最新年度の利率（分からなければ2025年度=10年満期時年平均利率0.525%、管理計画認定0.575%を基準とし、最新は要確認と明記）。
2. 日本の金利情勢の現状と今後の見通し（日銀の政策、長期金利の動向）を2〜3文で。
3. 上記シミュレーション結果をふまえた、すまい・る債活用に関する簡潔な助言（3〜4文）。
なお正確な制度事実として、すまい・る債は「発行から1年経過後は手数料なしで中途換金が可能」です（10年満期前でも大規模修繕等に取り崩せます）。これと矛盾しない記述にしてください。
出力は日本語のHTML断片のみ（<h3>や<p>、<ul><li>を使用可、コードフェンスやマークダウンは不可、<html>や<body>は不要）。`

  try {
    console.log('claude -p で最新情報の所見を生成中…（最大3分）')
    const out = execFileSync(
      'claude',
      ['-p', prompt, '--allowedTools', 'WebSearch', '--allowedTools', 'WebFetch'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180_000 }
    )
    const cleaned = out
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()
    if (cleaned.length > 40) return cleaned
    throw new Error('出力が短すぎます')
  } catch (e) {
    console.warn('claude -p を利用できませんでした。静的な所見を使用します。', (e as Error).message)
    return staticCommentary(d)
  }
}

const commentaryHtml = useClaude ? claudeCommentary(data) : staticCommentary(data)

// ---- 残高推移のSVGグラフ ----
function balanceChartSvg(d: ReportData): string {
  const W = 760
  const H = 280
  const padL = 56
  const padR = 16
  const padT = 16
  const padB = 28
  const series = d.balanceSeries
  const maxV = Math.max(
    ...series.map((s) => Math.max(s.withBond, s.withoutBond, s.expense)),
    1
  )
  const x = (i: number) => padL + (i / (series.length - 1)) * (W - padL - padR)
  const y = (v: number) => padT + (1 - v / maxV) * (H - padT - padB)
  const line = (key: 'withBond' | 'withoutBond') =>
    series.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`).join(' ')
  const barW = Math.max(2, (W - padL - padR) / series.length - 3)
  const bars = series
    .filter((s) => s.expense > 0)
    .map((s) => {
      const i = series.indexOf(s)
      return `<rect x="${(x(i) - barW / 2).toFixed(1)}" y="${y(s.expense).toFixed(1)}" width="${barW.toFixed(1)}" height="${(y(0) - y(s.expense)).toFixed(1)}" fill="#fca5a5" opacity="0.7"/>`
    })
    .join('')
  // Y軸目盛（億円）
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const v = maxV * t
    return `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="#eee"/><text x="${padL - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#888">${(v / 1e8).toFixed(1)}億</text>`
  })
  const xLabels = series
    .filter((_, i) => i % 5 === 0)
    .map((s) => {
      const i = series.indexOf(s)
      return `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#888">${s.year}</text>`
    })
    .join('')
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
    ${ticks.join('')}
    ${bars}
    <path d="${line('withoutBond')}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="5 4"/>
    <path d="${line('withBond')}" fill="none" stroke="#0ea5e9" stroke-width="2"/>
    ${xLabels}
  </svg>`
}

// ---- 表の組み立て ----
const bigWorksRows = data.bigWorks
  .map((w) => `<tr><td>${w.year}年</td><td class="r">${man(w.amount)}</td><td>${esc(w.label)}</td></tr>`)
  .join('')

const perAccountCaption = `シナリオ「${esc(data.meta.scenarioName)}」・物価上昇率 ${pct(data.meta.inflationRate * 100)}・すまい・る債 ${data.meta.currentUnitsPerYear}口/年 の前提で棟別に再計算`

const perAccountRows = data.perAccount
  .map(
    (a) => `<tr>
    <td>${esc(a.name)}</td><td class="r">${a.units}</td>
    <td class="r">${man(a.openingBalance)}</td>
    <td class="r ${a.minBalance.value < 0 ? 'neg' : ''}">${man(a.minBalance.value)}（${a.minBalance.year}年）</td>
    <td class="r ${a.shortfallYear ? 'neg' : 'ok'}">${a.shortfallYear ? `${a.shortfallYear}年に不足` : 'なし'}</td>
    <td class="r ${a.requiredIncreasePerUnitMonth > 0 ? 'neg' : 'ok'}">${a.requiredIncreasePerUnitMonth > 0 ? '+' + a.requiredIncreasePerUnitMonth.toLocaleString('ja-JP') : 'ショートなし'}</td>
  </tr>`
  )
  .join('')

function comparisonTable(c: ReportData['comparison'][number]): string {
  const rows = c.rows
    .map(
      (r) => `<tr class="${r.isCurrent ? 'hl' : ''}">
      <td>${esc(r.label)}${r.isCurrent ? ' ★' : ''}</td>
      <td class="r">${man(r.totalInterest)}</td>
      <td class="r ${r.benefit > 0 ? 'ok' : ''}">${r.unitsPerYear === 0 ? '—' : '+' + man(r.benefit)}</td>
      <td class="r">${man(r.minBalance.value)}（${r.minBalance.year}）</td>
      <td class="r ${r.shortfallYear ? 'neg' : 'ok'}">${r.shortfallYear ? r.shortfallYear + '年' : 'なし'}</td>
    </tr>`
    )
    .join('')
  return `<h4>${esc(c.scenario)}（債券 ${pct(c.bondRateStart)}〜 / 預金 ${pct(c.depositRate)}）</h4>
  <p class="sub">★ 現在選択中の口数。選択シナリオ「${esc(c.scenario)}」での試算。</p>
  <table>
    <thead><tr><th>戦略</th><th class="r">累計利息</th><th class="r">運用メリット</th><th class="r">最低残高</th><th class="r">資金ショート</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

const recReasons = data.recommendation.reason.map((r) => `<li>${esc(r)}</li>`).join('')

// ---- 運用プラン比較（3案）セクション ----
function planComparisonHtml(d: ReportData): string {
  const rows = d.plans.map((p: PlanEvalResult) => `
    <tr>
      <td>
        <strong>${esc(p.name)}</strong>
        <div style="font-size:10px;color:#64748b">${esc(p.purpose)}</div>
      </td>
      <td class="r">${p.unitsPerYear}口/年<br><span style="font-size:10px;color:#64748b">${man(p.yenPerYear)}</span></td>
      <td class="r ${p.actualPurchaseYears < 10 ? 'neg' : 'ok'}">${p.actualPurchaseYears}年</td>
      <td class="r">${man(p.cumulativePurchased)}</td>
      <td class="r ok">+${man(p.benefit)}</td>
      <td class="r ${p.minBalance.value < 0 ? 'neg' : ''}">${man(p.minBalance.value)}（${p.minBalance.year}年）</td>
      <td class="r ${p.shortfallYear ? 'neg' : 'ok'}">${p.shortfallYear ? p.shortfallYear + '年' : 'なし'}</td>
    </tr>`).join('')
  return `
    <table>
      <thead>
        <tr>
          <th>プラン</th>
          <th class="r">口数/年（年額）</th>
          <th class="r">継続年数</th>
          <th class="r">累計購入額</th>
          <th class="r">運用メリット</th>
          <th class="r">最低残高（年）</th>
          <th class="r">資金ショート</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="box">
      <p style="margin:0">
        <strong>考え方：</strong>楽観（積極）案は運用メリット最大ですが資金繰りがタイトで中途換金前提。
        堅実案は中途換金なしで10年間フル継続できる最大口数で無理のない運用。
        物件の遊休資金（約1.8億）と毎年の積立をどこまで運用に回すかは管理組合の判断です。
      </p>
    </div>
    <div class="box" style="background:#f0f9ff;border-color:#bae6fd">
      <p style="margin:0">
        <strong>制度の要点：</strong>
        1口50万円・購入上限≈2.2億（年間積立金収入＋前年度末残高）・継続は同一口数（変更は新規応募）・
        発行1年後から手数料なしで中途換金可。
        <strong>一括の大口購入より継続購入の方が累計利息が大きくなります</strong>（お金が働き続けるため）。
      </p>
    </div>`
}

// ---- 追加1: 口数の目安セクション ----
const opt = data.optimalUnits
const optimalUnitsHtml = `
  <div class="box">
    <table>
      <thead><tr><th>指標</th><th class="r">口数/年</th><th class="r">補足</th></tr></thead>
      <tbody>
        <tr class="hl"><td>メリット最大（積極策）</td><td class="r">${opt.optimalUnits}口</td><td>+${man(opt.optimalBenefit)}・中途換金を伴う場合あり</td></tr>
        <tr><td>無理なく10年継続（中途換金なし）</td><td class="r">${opt.maxContinuousUnits}口</td><td>10年間フル継続可能な上限</td></tr>
        <tr><td>現在の設定</td><td class="r">${data.meta.currentUnitsPerYear}口</td><td></td></tr>
      </tbody>
    </table>
    <p style="margin-bottom:0" class="sub">約${opt.optimalUnits}口でメリットがピーク。それを超えると継続購入が早期に打ち切られ逆効果になります。中途換金なしで10年完走できるのは${opt.maxContinuousUnits}口まで。</p>
  </div>`

// ---- 追加2: 必要な値上げの節約効果セクション ----
const ri = data.requiredIncrease
const currentInflationPct = pct(data.meta.inflationRate * 100)
const savingCurrent = ri.currentInflationNoBond - ri.currentInflationWithBond
const savingStress = ri.stress2pctNoBond - ri.stress2pctWithBond
const requiredIncreaseHtml = `
  <table>
    <thead>
      <tr>
        <th>物価上昇率</th>
        <th class="r">運用なし（円/戸月）</th>
        <th class="r">運用あり（円/戸月）</th>
        <th class="r">節約額（円/戸月）</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>現行 ${currentInflationPct}</td>
        <td class="r ${ri.currentInflationNoBond > 0 ? 'neg' : 'ok'}">${ri.currentInflationNoBond > 0 ? '+' + ri.currentInflationNoBond.toLocaleString('ja-JP') : 'ショートなし'}</td>
        <td class="r ${ri.currentInflationWithBond > 0 ? 'neg' : 'ok'}">${ri.currentInflationWithBond > 0 ? '+' + ri.currentInflationWithBond.toLocaleString('ja-JP') : 'ショートなし'}</td>
        <td class="r ok">${savingCurrent > 0 ? '▲' + savingCurrent.toLocaleString('ja-JP') : '—'}</td>
      </tr>
      <tr>
        <td>ストレス 2.0%</td>
        <td class="r neg">+${ri.stress2pctNoBond.toLocaleString('ja-JP')}</td>
        <td class="r ${ri.stress2pctWithBond > 0 ? 'neg' : 'ok'}">${ri.stress2pctWithBond > 0 ? '+' + ri.stress2pctWithBond.toLocaleString('ja-JP') : 'ショートなし'}</td>
        <td class="r ok">${savingStress > 0 ? '▲' + savingStress.toLocaleString('ja-JP') : '—'}</td>
      </tr>
    </tbody>
  </table>
  <div class="box warn">
    <p style="margin:0">すまい・る債は必要な値上げを月${savingStress > 0 ? savingStress.toLocaleString('ja-JP') : savingCurrent.toLocaleString('ja-JP')}円/戸ぶん節約する「補助輪」です。
    物価上昇による修繕費の増加（数億規模）は運用益（最大~1.3億）だけで全額カバーすることはできません。
    積立金の引き上げが主レバーであり、すまい・る債はその負担を軽減するツールです。</p>
  </div>`

// ---- 追加3: 棟別の毎月の修繕積立金セクション ----
const pam = data.perAccountMonthly
const yen = (n: number) => n.toLocaleString('ja-JP') + '円'
const perAccountMonthlyHtml = `
  <table>
    <thead>
      <tr>
        <th>会計・住戸</th>
        <th class="r">初年度（${data.meta.startYear}年）</th>
        <th class="r">最終年度（${data.meta.endYear}年）</th>
        <th>備考</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>団地会計（全372戸按分）</td><td class="r">${yen(pam.danchi.first)}/月</td><td class="r">${yen(pam.danchi.last)}/月</td><td>共用施設・外構・駐車場等</td></tr>
      <tr><td>ABC棟会計（202戸按分）</td><td class="r">${yen(pam.abc.first)}/月</td><td class="r">${yen(pam.abc.last)}/月</td><td>ABC棟の修繕にのみ使用</td></tr>
      <tr><td>DE棟会計（170戸按分）</td><td class="r">${yen(pam.de.first)}/月</td><td class="r">${yen(pam.de.last)}/月</td><td>DE棟の修繕にのみ使用</td></tr>
      <tr class="hl"><td><strong>ABC住戸が払う合計</strong>（ABC棟+団地）</td><td class="r"><strong>約${yen(pam.abcResident.first)}/月</strong></td><td class="r"><strong>約${yen(pam.abcResident.last)}/月</strong></td><td>ABC棟住民の実負担</td></tr>
      <tr class="hl"><td><strong>DE住戸が払う合計</strong>（DE棟+団地）</td><td class="r"><strong>約${yen(pam.deResident.first)}/月</strong></td><td class="r"><strong>約${yen(pam.deResident.last)}/月</strong></td><td>DE棟住民の実負担</td></tr>
    </tbody>
  </table>
  <div class="box"><p style="margin:0">棟別会計（ABC棟・DE棟）は各棟の修繕にのみ使えます。団地会計は全372戸共通の共用設備（外構・機械式駐車場等）に使用します。DE棟は大規模修繕が2035年（ABC棟の1年後）で設備更新費が多く、最終的にABC棟より高くなります。</p></div>`

// ---- HTML ----
const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Hiragino Sans","Noto Sans JP",sans-serif; color: #1e293b; font-size: 12px; line-height: 1.65; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 15px; margin: 22px 0 8px; padding-left: 8px; border-left: 4px solid #0ea5e9; }
  h3 { font-size: 13px; margin: 14px 0 6px; }
  h4 { font-size: 12px; margin: 12px 0 4px; color: #475569; }
  .sub { color: #64748b; font-size: 11px; }
  .kpis { display: flex; gap: 10px; margin: 10px 0; }
  .kpi { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; }
  .kpi .l { font-size: 10px; color: #64748b; }
  .kpi .v { font-size: 16px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 4px 6px; text-align: left; }
  th { background: #f1f5f9; font-weight: 600; font-size: 11px; }
  td.r, th.r { text-align: right; }
  .neg { color: #dc2626; font-weight: 700; }
  .ok { color: #059669; }
  tr.hl { background: #ecfeff; }
  tr.hl td { font-weight: 600; }
  .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin: 8px 0; }
  .warn { background: #fef2f2; border-color: #fecaca; }
  ul { margin: 4px 0 4px 18px; padding: 0; }
  .foot { color: #94a3b8; font-size: 10px; margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  .legend { font-size: 10px; color: #64748b; }
  .legend b { font-weight: 700; }
</style></head>
<body>
  <h1>修繕積立金 運用シミュレーション レポート</h1>
  <div class="sub">${esc(data.meta.name)} ／ 作成日 ${dateStr} ／ 対象期間 ${data.meta.startYear}〜${data.meta.endYear}年（${data.meta.endYear - data.meta.startYear + 1}年）</div>

  <div class="kpis">
    <div class="kpi"><div class="l">戸数</div><div class="v">${data.meta.units}戸</div></div>
    <div class="kpi"><div class="l">現在の修繕積立金残高</div><div class="v">${oku(data.meta.openingBalance)}</div></div>
    <div class="kpi"><div class="l">推奨: すまい・る債</div><div class="v">${data.recommendation.unitsPerYear}口/年<span style="font-size:11px">（${man(data.recommendation.yenPerYear)}）</span></div></div>
  </div>

  <h2>1. 資金の見通しと「棟別」の注意点</h2>
  <p>修繕積立金は<strong>団地・ABC棟・DE棟の3会計に分離</strong>されており、各棟の資金は各棟の修繕にのみ使えます。長期修繕計画は「1回目の大規模修繕でほぼ残高ゼロ」に設計されており、余裕がほとんどありません。</p>
  <p class="sub">${perAccountCaption}</p>
  <table>
    <thead><tr><th>会計</th><th class="r">戸数</th><th class="r">現在残高</th><th class="r">最低残高（到達年）</th><th class="r">資金ショート</th><th class="r">必要引き上げ（円/戸月）</th></tr></thead>
    <tbody>${perAccountRows}</tbody>
  </table>
  <div class="box"><p style="margin:0" class="sub">※ 棟別は原典3会計データ(geoSaito)から算出しており、combined値を手編集しても棟別には反映されません。すまい・る債の口数は combined の戸数按分（各棟戸数÷全372戸）で割り当てています。</p></div>
  <div class="box warn"><strong>ポイント：</strong> 実際の残高が計画をやや下回っており（新築時の修繕積立基金の入金が計画対比で遅れているため）、<strong>ABC棟の2034年・DE棟の2035年の1回目大規模修繕で資金が不足しかねません</strong>。ここを埋める余力づくりが課題です。</div>

  <h2>2. 大規模修繕・大型支出の予定（計画額）</h2>
  <table>
    <thead><tr><th>年</th><th class="r">金額</th><th>内容</th></tr></thead>
    <tbody>${bigWorksRows}</tbody>
  </table>
  <div class="legend">※ 長期修繕計画（2022年1月単価・消費税10%）に基づく計画額。本レポートは<strong>物価上昇率 ${pct(data.meta.inflationRate * 100)}/年</strong>を反映（0%＝計画書のまま）。
  <br>参考の目安：建設工事費は<strong>過去10年で約3割上昇（＝年平均約2.6%）</strong>、公共工事の労務単価は12年連続上昇（年約4%）。長期の修繕費前提は0%より1〜2%以上を置くのが安全側です（出典: 国交省 建設工事費デフレーター・公共工事設計労務単価）。</div>

  <h2>3. すまい・る債による効果（複数戦略の比較）</h2>
  <p>団地全体（3会計合算）で、選択シナリオ「${esc(data.meta.scenarioName)}」を基準に運用しない場合と比べた「運用メリット（＝増える資金）」と資金の安全性を試算しました。★ は現在選択中の口数です。</p>
  <div class="box" style="background:#f0f9ff;border-color:#bae6fd">
    <strong>用語の見方（はじめての方へ）</strong>
    <ul style="margin:4px 0 0 18px">
      <li><strong>「○口/年」＝毎年 購入する口数</strong>。すまい・る債は<strong>1口=50万円</strong>。例：<strong>80口/年＝毎年4,000万円</strong>を購入。最大10年続けると累計 最大4.0億円（実際は大規模修繕の年に中途換金するため、常に全額を保有するわけではありません）。</li>
      <li><strong>「累計利息」＝運用で得られる利息の30年合計</strong>。すまい・る債の受取利息（＝利率×元本を発行の翌年から満期まで毎年）＋余剰資金の預金利息の合計。例：4,000万円を利率2%で運用すると年80万円の利息。</li>
      <li><strong>「運用メリット」＝運用ありの期末資産 −運用なしの期末資産</strong>（＝運用したことで正味いくら増えたか）。</li>
    </ul>
  </div>
  ${data.comparison.map(comparisonTable).join('')}
  <div class="box"><strong>読み取り：</strong> 継続的に運用するほど効果が大きく、いずれの戦略でも資金ショートは発生しません。<strong>80口/年（毎年4,000万円）で30年累計 ${man(data.comparison[0].rows.find((r) => r.unitsPerYear === 80)?.benefit ?? 0)}</strong> の上乗せとなり、最低残高（2035年前後の底）も押し上がります。</div>

  <h2>4. 合算総資産の推移（${data.meta.currentUnitsPerYear}口/年・シナリオ「${esc(data.meta.scenarioName)}」）</h2>
  ${balanceChartSvg(data)}
  <div class="legend"><b style="color:#0ea5e9">━ すまい・る債運用あり</b>　<b style="color:#94a3b8">┈ 運用なし</b>　<b style="color:#fca5a5">▮ 修繕支出</b></div>

  <h2>5. すまい・る債 運用プラン比較（3案）</h2>
  <p>物件の資金状況に合わせた3案を比較します。シナリオ「${esc(data.meta.scenarioName)}」・物価上昇率 ${pct(data.meta.inflationRate * 100)} での試算。</p>
  ${planComparisonHtml(data)}
  ${data.meta.reserveBoost ? `<div class="box"><p style="margin:0"><strong>積立金の引き上げ設定：</strong>+${data.meta.reserveBoost.perUnitMonth.toLocaleString('ja-JP')}円/戸月（${data.meta.reserveBoost.fromYear}年〜） ／ 30年追加徴収 ${man(data.meta.reserveBoost.totalExtra)}</p></div>` : ''}

  <h2>6. すまい・る債 口数の目安（最適口数の自動試算）</h2>
  <p>シミュレーションにより、この物件での口数ごとの運用メリットを自動試算した結果です。</p>
  ${optimalUnitsHtml}

  <h2>7. 運用は「必要な値上げを月いくら節約するか」</h2>
  <p>資金ショートを解消するために必要な戸あたり月額の引き上げ額と、すまい・る債運用による節約額の試算です。</p>
  ${requiredIncreaseHtml}

  <h2>8. 棟別の毎月の修繕積立金</h2>
  <p>各会計の戸あたり平均月額（積立金収入÷戸数÷12）の初年度・最終年度と、住戸が実際に払う合計（棟別＋団地）の比較です。</p>
  ${perAccountMonthlyHtml}

  <h2>9. 最新の利率・金利情勢に関する所見</h2>
  ${commentaryHtml}

  <div class="foot">
    本レポートは長期修繕計画・収支報告書をもとにした概算試算であり、実際の運用・利息・工事費を保証するものではありません。
    利率は毎年度、住宅金融支援機構が決定します。金額は表示上、万円・億円で丸めています。
    シナリオ「${esc(data.meta.scenarioName)}」・物価上昇率 ${pct(data.meta.inflationRate * 100)} を基準に作成。
  </div>
</body></html>`

// ---- 出力 ----
const outDir = join(ROOT, 'reports')
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
const htmlPath = join(outDir, `report_${stamp}.html`)
const pdfPath = join(outDir, `ジオ彩都_修繕積立金レポート_${stamp}.pdf`)
writeFileSync(htmlPath, html, 'utf8')
console.log(`HTMLを書き出しました: ${htmlPath}`)

// ---- ヘッドレスChromeでPDF化 ----
const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]
const chrome = chromeCandidates.find((p) => existsSync(p))
if (!chrome) {
  console.error('ChromeまたはEdgeが見つかりませんでした。HTMLをブラウザで開き、印刷→PDFで保存してください:', htmlPath)
  process.exit(1)
}
execFileSync(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=3000',
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`,
  ],
  { stdio: 'ignore' }
)
console.log(`\n✅ PDFを生成しました:\n${pdfPath}`)

if (doOpen) {
  try {
    execFileSync('open', [pdfPath])
  } catch {
    /* noop */
  }
}
