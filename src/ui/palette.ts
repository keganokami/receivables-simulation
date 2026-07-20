// データ可視化の検証済みパレット（categorical slots）。
// 同じエンティティは全チャートで必ず同じ色にする（色は順位ではなくエンティティに従う）。
export const SERIES = {
  bond: '#2a78d6', // すまい・る債（保有残高・運用あり）      slot1 blue
  liquid: '#1baf7a', // 流動資金                                slot5 aqua
  expense: '#e34948', // 修繕支出                                slot8 red
  reserve: '#4a3aa7', // 修繕積立金収入・戸あたり月額            slot7 violet
  danchi: '#008300', // 団地会計                                slot2 green
  abc: '#2a78d6', // ABC棟（＝bondと同じ青。同一チャートに同居しないこと）
  de: '#eda100', // DE棟                                    slot4 yellow
  baseline: '#6b7280', // 「運用なし」「削減前」などのベースライン（破線・グレー）
} as const
