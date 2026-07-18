import { describe, it, expect } from 'vitest'
import { parseCsv, loadCsv, serializeConfig, parseConfig } from './io'
import { SAMPLE_INPUT, SAMPLE_STRATEGY } from './sampleData'

describe('parseCsv', () => {
  it('基本的なCSVを行列に分解する', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })
  it('クォート内のカンマを保持する', () => {
    expect(parseCsv('年度,項目\n2034,"外壁,防水"')).toEqual([
      ['年度', '項目'],
      ['2034', '外壁,防水'],
    ])
  })
  it('空行を無視する', () => {
    expect(parseCsv('a\n\n1\n')).toEqual([['a'], ['1']])
  })
})

describe('loadCsv 種別判定', () => {
  it('段階増額計画を判定して読む', () => {
    const r = loadCsv('適用開始年度,戸あたり月額\n2022,7000\n2027,9000')
    expect(r.kind).toBe('reserveSteps')
    expect(r.patch.reserveSteps).toEqual([
      { fromYear: 2022, monthlyPerUnit: 7000 },
      { fromYear: 2027, monthlyPerUnit: 9000 },
    ])
  })

  it('長期修繕計画を判定して読む', () => {
    const r = loadCsv('年度,金額,項目\n2034,80000000,第1回大規模修繕')
    expect(r.kind).toBe('repairPlan')
    expect(r.patch.repairPlan).toEqual([
      { year: 2034, amount: 80000000, label: '第1回大規模修繕' },
    ])
  })

  it('その他収支を判定して読む（負の支出も）', () => {
    const r = loadCsv('年度,金額,摘要\n2026,600000,駐車場収入\n2030,-300000,臨時補修')
    expect(r.kind).toBe('otherCashflows')
    expect(r.patch.otherCashflows).toEqual([
      { year: 2026, amount: 600000, note: '駐車場収入' },
      { year: 2030, amount: -300000, note: '臨時補修' },
    ])
  })

  it('「万」「カンマ」「¥」付きの金額を解釈する', () => {
    const r = loadCsv('年度,金額,項目\n2034,"8,000万",大規模修繕')
    expect(r.patch.repairPlan![0].amount).toBe(80_000_000)
  })

  it('判定不能なヘッダーは例外', () => {
    expect(() => loadCsv('foo,bar\n1,2')).toThrow()
  })
})

describe('JSON設定の round-trip', () => {
  it('書き出して読み戻すと一致する', () => {
    const json = serializeConfig(SAMPLE_INPUT, SAMPLE_STRATEGY, 2)
    const bundle = parseConfig(json)
    expect(bundle.input).toEqual(SAMPLE_INPUT)
    expect(bundle.strategy).toEqual(SAMPLE_STRATEGY)
    expect(bundle.scenarioIdx).toBe(2)
  })
  it('不正なJSONは例外', () => {
    expect(() => parseConfig('{"foo":1}')).toThrow()
  })
})
