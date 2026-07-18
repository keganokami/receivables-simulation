import { AssociationInput, BondStrategy, OtherCashflow, RepairItem, ReserveStep } from './types'

// ============================================================================
// データの読み込み / 書き出し
//
// - CSV: 理事会がExcel/スプレッドシートで編集できるよう、表ごとに分けて読む。
//   ヘッダー行の見出しでファイル種別を自動判定する（順序・列数が多少違ってもOK）。
// - JSON: 設定一式（前提条件＋運用戦略）を1ファイルで保存/復元する。
//
// すべてブラウザ内で処理し、サーバーへは送信しない。
// ============================================================================

/** 設定一式のバンドル（JSON保存の単位） */
export interface ConfigBundle {
  version: 1
  input: AssociationInput
  strategy: BondStrategy
  scenarioIdx: number
}

/** CSV読込でどの表が更新されたか */
export type CsvKind = 'reserveSteps' | 'repairPlan' | 'otherCashflows'

export interface CsvLoadResult {
  kind: CsvKind
  count: number
  /** 読み込んだ値を反映した input の部分更新 */
  patch: Partial<AssociationInput>
}

// ---------------------------------------------------------------------------
// CSV パーサ（ダブルクォート・カンマ含みフィールド対応の最小実装）
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // BOM除去
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      field = ''
      // 空行はスキップ
      if (row.some((v) => v.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  // 最終フィールド
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((v) => v.trim() !== '')) rows.push(row)
  }
  return rows
}

/** 「1,600,000」「¥800万」等を数値に。万・円・カンマ・空白を許容。 */
function toNum(raw: string): number {
  const t = raw.trim().replace(/[,，\s¥円]/g, '')
  if (t.includes('万')) {
    const n = parseFloat(t.replace('万', ''))
    return Number.isFinite(n) ? n * 10_000 : 0
  }
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : 0
}

function headerHas(header: string[], keyword: string): boolean {
  return header.some((h) => h.includes(keyword))
}

function colIndex(header: string[], ...keywords: string[]): number {
  for (const kw of keywords) {
    const i = header.findIndex((h) => h.includes(kw))
    if (i >= 0) return i
  }
  return -1
}

/**
 * CSVテキストを読み、ヘッダーから種別を自動判定して input への部分更新を返す。
 * 判定できない場合は例外を投げる。
 */
export function loadCsv(text: string): CsvLoadResult {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('データ行がありません（ヘッダー＋1行以上が必要です）')
  const header = rows[0].map((h) => h.trim())
  const body = rows.slice(1)

  // ① 段階増額計画
  if (headerHas(header, '適用開始') || (headerHas(header, '開始年') && headerHas(header, '月額'))) {
    const yi = colIndex(header, '適用開始', '開始年', '年度')
    const mi = colIndex(header, '月額', '戸あたり', '積立')
    const reserveSteps: ReserveStep[] = body
      .map((r) => ({ fromYear: toNum(r[yi]), monthlyPerUnit: toNum(r[mi]) }))
      .filter((s) => s.fromYear > 0)
    return { kind: 'reserveSteps', count: reserveSteps.length, patch: { reserveSteps } }
  }

  // ③ その他収支（摘要 or その他 を含む。修繕計画より先に判定すると誤検知するので項目より後）
  if (headerHas(header, '摘要') || headerHas(header, 'その他')) {
    const yi = colIndex(header, '年度', '年')
    const ai = colIndex(header, '金額', '額')
    const ni = colIndex(header, '摘要', '備考', 'メモ')
    const otherCashflows: OtherCashflow[] = body
      .map((r) => ({ year: toNum(r[yi]), amount: toNum(r[ai]), note: ni >= 0 ? r[ni]?.trim() : '' }))
      .filter((c) => c.year > 0)
    return { kind: 'otherCashflows', count: otherCashflows.length, patch: { otherCashflows } }
  }

  // ② 長期修繕計画（年度・金額・項目）
  if (headerHas(header, '年度') && headerHas(header, '金額')) {
    const yi = colIndex(header, '年度', '年')
    const ai = colIndex(header, '金額', '額')
    const li = colIndex(header, '項目', '工事', '内容', '名称')
    const repairPlan: RepairItem[] = body
      .map((r) => ({ year: toNum(r[yi]), amount: toNum(r[ai]), label: li >= 0 ? r[li]?.trim() : '修繕' }))
      .filter((c) => c.year > 0 && c.amount > 0)
    return { kind: 'repairPlan', count: repairPlan.length, patch: { repairPlan } }
  }

  throw new Error(
    'CSVの種別を判定できませんでした。ヘッダーに「適用開始年度/月額」「年度/金額/項目」「年度/金額/摘要」のいずれかを含めてください。'
  )
}

// ---------------------------------------------------------------------------
// JSON 設定の保存/復元
// ---------------------------------------------------------------------------
export function serializeConfig(
  input: AssociationInput,
  strategy: BondStrategy,
  scenarioIdx: number
): string {
  const bundle: ConfigBundle = { version: 1, input, strategy, scenarioIdx }
  return JSON.stringify(bundle, null, 2)
}

export function parseConfig(json: string): ConfigBundle {
  const obj = JSON.parse(json)
  if (!obj || typeof obj !== 'object' || !obj.input || !obj.strategy) {
    throw new Error('設定ファイルの形式が不正です（input / strategy が必要）。')
  }
  return obj as ConfigBundle
}

// ---------------------------------------------------------------------------
// テンプレートCSV（理事会が記入用に書き出して使う）
// ---------------------------------------------------------------------------
export const CSV_TEMPLATES: Record<CsvKind, { filename: string; content: string }> = {
  reserveSteps: {
    filename: 'reserve_steps.csv',
    content: ['適用開始年度,戸あたり月額', '2022,7000', '2027,9000', '2032,16000'].join('\n'),
  },
  repairPlan: {
    filename: 'repair_plan.csv',
    content: [
      '年度,金額,項目',
      '2034,80000000,第1回大規模修繕',
      '2040,10000000,給排水設備',
      '2046,120000000,第2回大規模修繕',
    ].join('\n'),
  },
  otherCashflows: {
    filename: 'other_cashflows.csv',
    content: ['年度,金額,摘要', '2026,600000,駐車場収入', '2030,-300000,臨時補修'].join('\n'),
  },
}

/** ブラウザでテキストをファイルとしてダウンロードさせる */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime }) // ExcelでUTF-8と認識させるためBOM付与
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
