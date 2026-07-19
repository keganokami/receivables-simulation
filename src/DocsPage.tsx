import type { ReactNode } from 'react'

// ============================================================================
// 資料・ノウハウページ
// 理事会メンバーが学習・共有できる「事実ベースの資料集」。
// 意見・提案・返答文は含めず、事実と出典のみを掲載する。
// ============================================================================

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 print:bg-white">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
        <header className="mb-8 border-b border-slate-200 pb-6">
          <h1 className="text-2xl font-bold text-slate-900">資料・ノウハウ</h1>
          <p className="mt-2 text-sm text-slate-600">
            マンションの修繕積立金の運用・目安に関する事実と出典の整理です。理事会での学習・共有を目的としています。
          </p>
          <div className="mt-3 text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-md p-3 space-y-1">
            <p>最終調査日：2026年7月</p>
            <p>利率・制度は変更されるため、判断の際は各出典（一次情報）で必ず最新情報をご確認ください。</p>
          </div>
        </header>

        <article className="space-y-10 text-sm leading-relaxed text-slate-700">
          <Section number={1} title="マンションすまい・る債（住宅金融支援機構）">
            <SubSection title="購入単位・継続">
              <ul className="list-disc list-inside space-y-1">
                <li>1口50万円の利付10年債。10年満期、年1回利息受取。</li>
                <li>継続購入は応募時に届け出た口数を毎年、最大10回まで（1回のみの購入も可）。</li>
                <li>継続は毎年同一口数。購入した口数の分割・変更は不可。</li>
                <li>口数の増額・減額、中断後の再開、10回終了後の再開は、いずれも新規応募が必要。</li>
              </ul>
            </SubSection>

            <SubSection title="購入上限">
              <ul className="list-disc list-inside space-y-1">
                <li>
                  原則「マンション全体の1年あたりの修繕積立金額」＋「前年度決算における修繕積立金会計の残高（借入金額を除く）」の合計金額の範囲内。
                </li>
              </ul>
            </SubSection>

            <SubSection title="募集（2026年度）">
              <ul className="list-disc list-inside space-y-1">
                <li>応募受付：2026年4月13日〜10月9日。先着順で、募集口数に達した時点で受付終了。</li>
                <li>募集口数：582,089口（総額2,910億4,450万円）※通常・ステップアップ・認定の合計。</li>
              </ul>
            </SubSection>

            <SubSection title="利率（10年満期時 年平均利率・税引前）">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600">
                      <Th>年度</Th>
                      <Th>通常</Th>
                      <Th>ステップアップ</Th>
                      <Th>認定</Th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="odd:bg-white even:bg-slate-50">
                      <Td>2025年度</Td>
                      <Td>0.525%</Td>
                      <Td>—</Td>
                      <Td>0.575%</Td>
                    </tr>
                    <tr className="odd:bg-white even:bg-slate-50">
                      <Td>2026年度</Td>
                      <Td className="font-semibold text-slate-800">2.000%</Td>
                      <Td className="font-semibold text-slate-800">2.050%</Td>
                      <Td className="font-semibold text-slate-800">2.100%</Td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-2">利率は毎年度、住宅金融支援機構が決定する。</p>
            </SubSection>

            <SubSection title="応募資格">
              <ul className="list-disc list-inside space-y-1">
                <li>管理組合・管理組合法人のみ（個人・法人は不可）。分譲マンションが対象（賃貸マンション・沖縄県内のマンションは対象外）。</li>
                <li>長期修繕計画の計画期間が20年以上（20年の起点は「計画を策定した時点」）。</li>
                <li>反社会的勢力と関係がないこと。将来的に共用部分リフォーム融資の申込みを検討している管理組合が対象（結果的に融資を受けなくても違約金等はなし）。</li>
                <li>総会決議は応募要件ではないが、修繕積立金の運用方法が管理規約に規定されている場合があるため事前確認が必要。</li>
              </ul>
            </SubSection>

            <SubSection title="中途換金">
              <ul className="list-disc list-inside space-y-1">
                <li>
                  初回債券発行日から1年以上経過すれば、手数料なしで1口単位で中途換金可能。やむを得ない事情があれば1年未満でも可能な場合あり。
                </li>
                <li>
                  保有残高の範囲内で一部・全部可、複数回可（同じ月に換金できるのは1回のみ）。換金額は1口50万円＋経過利息。
                </li>
                <li>発行から2か月以内の債券、買入代金の支払日が満期日と同じ月になる債券は除く。</li>
              </ul>
            </SubSection>

            <SubSection title="信用力（重要）">
              <ul className="list-disc list-inside space-y-1">
                <li>
                  政府保証はない。機構は「元本及び利息の支払について政府の保証はなく、機構の財務状況の悪化等によっては元本や利息の支払いが滞る可能性や、元本割れが生じる可能性がある」と明示（＝政府保証債ではなく財投機関債の位置づけ）。
                </li>
                <li>預金保険（ペイオフ）の対象外。</li>
                <li>
                  ただし独立行政法人住宅金融支援機構法により、機構の財産から一般の先取特権に次いで優先的に弁済を受ける権利（一般担保）が定められている。
                </li>
                <li>
                  機構は国債と同等水準の発行体格付を外部機関から取得（すまい・る債個別の格付ではなく発行体格付）。資本金の100%を政府が出資する独立行政法人。
                </li>
              </ul>
            </SubSection>

            <Sources
              links={[
                { href: 'https://www.jhf.go.jp/kanri/smile/index.html', label: '住宅金融支援機構 マンションすまい・る債' },
                { href: 'https://www.jhf.go.jp/kanri/smile/bosyu/index.html', label: '募集案内' },
                { href: 'https://jhffaq.jp/jhffaq/jhf/web/listByCategory_smile.html', label: 'よくある質問' },
                { href: 'https://www.jhf.go.jp/loan/kanri/smile/about/gaiyo.html', label: '制度概要' },
              ]}
            />
          </Section>

          <Section number={2} title="国債（管理組合が購入できるもの）">
            <SubSection title="個人向け国債（現行）">
              <ul className="list-disc list-inside space-y-1">
                <li>購入できるのは個人のみ。管理組合は購入不可（現時点）。</li>
              </ul>
            </SubSection>

            <SubSection title="新窓販国債（新型窓口販売方式）">
              <ul className="list-disc list-inside space-y-1">
                <li>購入者に制限がなく、法人やマンション管理組合でも購入可能。</li>
                <li>額面5万円から5万円の整数倍。国債の種類ごとに一申込みあたり額面3億円が上限。</li>
                <li>種類は満期2年・5年・10年の固定金利型。</li>
                <li>
                  途中売却は市場価格。金利上昇等による債券価格の下落により、途中売却の際は投資元本を割り込むことがある。市場環境によっては売却できない可能性もある。
                </li>
                <li>
                  満期保有であれば価格変動リスクは回避できるが、募集価格が額面を上回る「オーバーパー発行」の場合、満期償還は額面のため償還差損が生じる点に注意。
                </li>
              </ul>
            </SubSection>

            <SubSection title="個人向け国債プラス（2027年1月発行分〜）">
              <ul className="list-disc list-inside space-y-1">
                <li>
                  令和8年12月募集分（令和9年＝2027年1月発行分）から販売対象を法人等に拡大し、名称が「個人向け国債」から「個人向け国債プラス」に変更予定。商品ラインナップおよび基本的な商品性等に変更はなし。
                </li>
                <li>
                  対象：一般社団法人・一般財団法人・学校法人・医療法人・管理組合法人・社会福祉法人・NPO法人等の非営利法人、非上場株式会社（資本金5億円未満）、合同会社など。法人格を持たない任意組合形態のマンション管理組合も対象。金融商品取引法上「一般投資家」に区分される主体が対象（金融機関等のプロ投資家は対象外）。
                </li>
                <li>ラインナップは3種類：変動10年 / 固定5年 / 固定3年。</li>
                <li>
                  商品性：途中換金でも元本割れしない設計、最低金利0.05%保証、1万円から購入可能、半年ごとの利子受取、毎月募集・発行。
                </li>
                <li>
                  中途換金：発行後1年間は原則不可。中途換金時は直前2回分の各利子相当額に0.79685を掛けた金額が差し引かれる。
                </li>
                <li>2026年6月募集分の適用金利：変動10年 1.74% / 固定5年 1.86% / 固定3年 1.51%。</li>
                <li>
                  注意：市場で取引される10年国債の利回りと、個人向け国債の適用金利は異なる（変動10年は基準金利×0.66で決まるため、市場利回りより低くなる）。
                </li>
                <li>
                  金融機関によってはシステム対応等により法人等への販売が予定日程より遅くなる可能性があるため、取引金融機関への事前確認が必要。
                </li>
              </ul>
            </SubSection>

            <SubSection title="個人向け国債の適用利率の計算式（財務省）">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600">
                      <Th align="left">タイプ</Th>
                      <Th align="left">適用利率</Th>
                      <Th align="left">基準金利</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['変動10年', '基準金利 × 0.66', '10年固定利付国債の入札における平均落札価格を基に計算される複利利回り'],
                      ['固定5年', '基準金利 − 0.05%', '募集期間開始日の2営業日前における期間5年の固定利付国債の想定利回り'],
                      ['固定3年', '基準金利 − 0.03%', '募集期間開始日の2営業日前における期間3年の固定利付国債の想定利回り'],
                    ].map((row) => (
                      <tr key={row[0]} className="odd:bg-white even:bg-slate-50">
                        {row.map((cell, i) => (
                          <Td key={i} align="left" className={i === 0 ? 'font-medium text-slate-700' : ''}>
                            {cell}
                          </Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="list-disc ml-5 space-y-1 mt-2">
                <li>
                  変動10年は「掛け算（×0.66）」のため、<strong>適用利率は基準金利を必ず下回る</strong>（基準金利2.7%なら 2.7×0.66＝約1.78%）。
                </li>
                <li>
                  財務省は0.66の理由を「10年固定利付国債を今後10年間保有した場合に得られる金利収入とのバランスや、<strong>中途換金などの商品性を総合的に勘案</strong>した結果」と説明している。
                </li>
                <li>
                  固定5年・固定3年は「引き算」のため、その年限の基準金利をほぼそのまま反映する。
                </li>
                <li>
                  財務省は「<strong>金利が上昇する局面では、掛け算（×0.66）である変動10年よりも、引き算（−0.05%）である固定5年の方が、基準金利の上昇をより反映しやすい</strong>」としている。
                </li>
                <li>3タイプとも年率0.05%の最低金利保証があり、金利に上限はない。</li>
                <li>
                  計算例：基準金利1.50%の場合 → 変動10年 0.99% ／ 固定5年 1.45% ／ 固定3年 1.47%。
                </li>
                <li>
                  平成23年6月までに発行された変動10年は「基準金利 − 0.80%」方式だったが、同年7月発行分より現行方式に変更（過去の銘柄は変更なし）。
                </li>
              </ul>
            </SubSection>

            <Sources
              links={[
                { href: 'https://www.mof.go.jp/jgbs/individual/kojinmuke/plus/', label: '財務省 個人向け国債プラス' },
                { href: 'https://www.mof.go.jp/jgbs/individual/kojinmuke/main/qa/answer_qc.html', label: '財務省 個人向け国債の金利についてのFAQ' },
                { href: 'https://www.mof.go.jp/jgbs/individual/kojinmuke/main/outline/hendou/', label: '財務省「変動10年」商品概要' },
                { href: 'https://www.mof.go.jp/jgbs/individual/kojinmuke/shinmadohan/qa/', label: '新窓販国債 Q&A' },
                { href: 'https://www.mof.go.jp/jgbs/individual/kojinmuke/shinmadohan/', label: '新窓販国債' },
                { href: 'https://www.jiji.com/jc/article?k=2025050801260&g=eco', label: '時事ドットコム 関連記事' },
              ]}
            />
          </Section>

          <Section number={3} title="運用商品の比較（事実の整理）">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <Th align="left">項目</Th>
                    <Th align="left">すまい・る債</Th>
                    <Th align="left">新窓販国債</Th>
                    <Th align="left">個人向け国債プラス（2027年〜）</Th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['管理組合の購入', '可（管理組合のみ）', '可（制限なし）', '可（予定）'],
                    ['利率', '2.000%（認定2.100%・2026年度）', '固定・市場実勢', '変動10年1.74%等（2026年6月募集分）'],
                    ['満期', '10年', '2年・5年・10年', '変動10年・固定5年・固定3年'],
                    ['募集頻度', '年1回', '毎月', '毎月'],
                    ['途中換金', '発行1年後・額面50万＋経過利息', '市場価格（元本割れ有）', '発行1年後・元本割れなし（直前2回分利子相当額を差引）'],
                    ['政府保証', 'なし（一般担保あり・発行体格付は国債同等）', 'あり（国が発行）', 'あり（国が発行）'],
                    ['ペイオフ', '対象外', '対象外', '対象外'],
                  ].map((row) => (
                    <tr key={row[0]} className="odd:bg-white even:bg-slate-50">
                      {row.map((cell, i) => (
                        <Td key={i} align="left" className={i === 0 ? 'font-medium text-slate-700' : ''}>
                          {cell}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section number={4} title="修繕積立金の目安（国土交通省ガイドライン）">
            <ul className="list-disc list-inside space-y-1">
              <li>「マンションの修繕積立金に関するガイドライン」平成23年策定、令和3年9月改定・令和6年6月改定。</li>
            </ul>
            <p className="mt-3 font-medium text-slate-700">計画期間全体における修繕積立金の平均額の目安（機械式駐車場分を除く）</p>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <Th align="left">区分</Th>
                    <Th align="right">目安（円/㎡・月）</Th>
                    <Th align="left">備考</Th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['20階未満・延床5,000㎡未満', '335', ''],
                    ['20階未満・延床5,000〜10,000㎡', '252', '事例の3分の2が包含される幅：170〜320円'],
                    ['20階未満・延床10,000〜20,000㎡未満', '271', ''],
                    ['20階未満・延床20,000㎡以上', '255', ''],
                    ['20階以上', '338', ''],
                  ].map((row) => (
                    <tr key={row[0]} className="odd:bg-white even:bg-slate-50">
                      <Td align="left" className="font-medium text-slate-700">{row[0]}</Td>
                      <Td>{row[1]}</Td>
                      <Td align="left" className="text-slate-500">{row[2]}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 font-medium text-slate-700">機械式駐車場は別途加算（1台あたり月額の目安）</p>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <Th align="left">形式</Th>
                    <Th align="right">目安（円/月・1台）</Th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['2段（ピット1段）昇降式', '6,450'],
                    ['3段（ピット2段）昇降式', '5,840'],
                    ['3段（ピット1段）昇降横行式', '7,210'],
                    ['4段（ピット2段）昇降横行式', '6,235'],
                  ].map((row) => (
                    <tr key={row[0]} className="odd:bg-white even:bg-slate-50">
                      <Td align="left" className="font-medium text-slate-700">{row[0]}</Td>
                      <Td>{row[1]}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="list-disc list-inside space-y-1 mt-3">
              <li>
                令和6年改定で段階増額積立方式の考え方を追加：均等積立方式とした場合の月額を基準額として、計画の初期額は基準額の0.6倍以上、最終額は1.1倍以内とする。
              </li>
              <li>
                平均値だけでなく、自らのマンションの規模・施設・築年数を踏まえ「事例の3分の2が包含される幅」のどこに属するかを意識して活用することが望ましい。
              </li>
            </ul>
            <Sources
              links={[
                { href: 'https://www.mlit.go.jp/jutakukentiku/house/content/001747009.pdf', label: 'マンションの修繕積立金に関するガイドライン' },
                { href: 'https://www.mlit.go.jp/report/press/house03_hh_000204.html', label: '国土交通省 報道発表' },
              ]}
            />
          </Section>

          <Section number={5} title="修繕費・建設費の物価動向">
            <ul className="list-disc list-inside space-y-1">
              <li>
                建設工事費デフレーター（2015年度=100）は2025年8月時点で約130＝過去10年で約3割上昇（年平均約2.6%）。
              </li>
              <li>
                2021年半ば〜2022年半ばは前年同月比10%を超える月もあった（ウッドショック・エネルギー価格・円安等による資材高騰）。
              </li>
              <li>2023年半ば以降は上昇が鈍化したが、2024年以降は労務費（人件費）主導で再び上昇。</li>
              <li>
                公共工事設計労務単価は2013年以降12年連続で上昇し、2013年度15,175円→2024年3月23,600円で約55%上昇（年約4%）。
              </li>
              <li>建築費指数（建設物価調査会）2025年10月分：工事原価140.8／建築143.4／設備137.8。</li>
              <li>長期修繕計画の金額は策定時点の単価であることが多く、将来支出を見積もる際は物価上昇の考慮が必要。</li>
            </ul>
            <Sources
              links={[
                { href: 'https://www.mlit.go.jp/sogoseisaku/jouhouka/sosei_jouhouka_tk4_000112.html', label: '国土交通省 建設工事費デフレーター等' },
              ]}
            />
          </Section>

          <Section number={6} title="金利情勢（2026年7月時点）">
            <ul className="list-disc list-inside space-y-1">
              <li>日本銀行の政策金利は2026年6月に1.0%へ引き上げ。</li>
              <li>10年国債利回りは2.7〜2.8%前後で推移。</li>
              <li>この環境を受け、すまい・る債の利率は2025年度0.525%→2026年度2.000%へ引き上げられた。</li>
            </ul>
          </Section>

          <Section number={7} title="本シミュレーターがモデル化している範囲（注記）">
            <ul className="list-disc list-inside space-y-1">
              <li>
                モデル化：1口50万円・年1回・最大10回・同一口数継続・購入上限・発行1年後の中途換金・利率シナリオ・物価上昇率・積立金の段階増額と引き上げ。
              </li>
              <li>モデル化していない：応募資格の判定、募集枠（先着）、国債等の他商品、税務。</li>
            </ul>
          </Section>
        </article>
      </div>
    </div>
  )
}

// ============================================================================
// UI部品
// ============================================================================

function Section({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-bold text-slate-900 border-b border-slate-200 pb-2 mb-4">
        {number}. {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function SubSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-800 mb-1.5">{title}</h3>
      {children}
    </div>
  )
}

function Sources({ links }: { links: { href: string; label: string }[] }) {
  return (
    <div className="pt-1">
      <p className="text-xs font-semibold text-slate-500 mb-1">出典</p>
      <ul className="text-xs text-sky-700 space-y-0.5 list-disc list-inside">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-sky-900 break-all"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Th({ children, align = 'right' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-2 py-1.5 font-medium border-b border-slate-200 ${
        align === 'left' ? 'text-left' : 'text-right'
      }`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align = 'right',
  className = '',
}: {
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <td
      className={`px-2 py-1.5 border-b border-slate-100 ${
        align === 'left' ? 'text-left' : 'text-right'
      } ${className}`}
    >
      {children}
    </td>
  )
}
