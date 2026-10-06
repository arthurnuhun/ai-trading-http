import { describe, it, expect } from 'vitest';
import { createCot } from '../src/providers/macro/cot.js';

// Real COMEX Gold rows (CFTC public reporting API), selected fields only.
const DISAGG: any[] = [{"report_date_as_yyyy_mm_dd":"2026-09-29T00:00:00.000","yyyy_report_week_ww":"2026 Report Week 39","market_and_exchange_names":"GOLD - COMMODITY EXCHANGE INC.","cftc_contract_market_code":"088691","contract_units":"(CONTRACTS OF 100 TROY OUNCES)","futonly_or_combined":"FutOnly","open_interest_all":"406456","prod_merc_positions_long":"18200","prod_merc_positions_short":"39463","swap_positions_long_all":"14835","swap__positions_short_all":"244539","swap__positions_spread_all":"25796","m_money_positions_long_all":"131711","m_money_positions_short_all":"11393","m_money_positions_spread":"36294","other_rept_positions_long":"118025","other_rept_positions_short":"19711","other_rept_positions_spread":"12811","tot_rept_positions_long_all":"357672","tot_rept_positions_short":"390007","nonrept_positions_long_all":"48784","nonrept_positions_short_all":"16449","change_in_open_interest_all":"-6344","change_in_m_money_long_all":"-3988","change_in_m_money_short_all":"3083","pct_of_oi_m_money_long_all":"32.4","pct_of_oi_m_money_short_all":"2.8","traders_tot_all":"286","traders_m_money_long_all":"80","traders_m_money_short_all":"17"},{"report_date_as_yyyy_mm_dd":"2026-09-22T00:00:00.000","yyyy_report_week_ww":"2026 Report Week 38","market_and_exchange_names":"GOLD - COMMODITY EXCHANGE INC.","cftc_contract_market_code":"088691","contract_units":"(CONTRACTS OF 100 TROY OUNCES)","futonly_or_combined":"FutOnly","open_interest_all":"412800","prod_merc_positions_long":"17719","prod_merc_positions_short":"44496","swap_positions_long_all":"14626","swap__positions_short_all":"250752","swap__positions_spread_all":"25113","m_money_positions_long_all":"135699","m_money_positions_short_all":"8310","m_money_positions_spread":"32876","other_rept_positions_long":"118283","other_rept_positions_short":"19819","other_rept_positions_spread":"16047","tot_rept_positions_long_all":"360363","tot_rept_positions_short":"397413","nonrept_positions_long_all":"52437","nonrept_positions_short_all":"15387","change_in_open_interest_all":"2901","change_in_m_money_long_all":"-6695","change_in_m_money_short_all":"-968","pct_of_oi_m_money_long_all":"32.9","pct_of_oi_m_money_short_all":"2.0","traders_tot_all":"293","traders_m_money_long_all":"92","traders_m_money_short_all":"14"}];

const LEGACY: any[] = [{"report_date_as_yyyy_mm_dd":"2026-09-29T00:00:00.000","yyyy_report_week_ww":"2026 Report Week 39","market_and_exchange_names":"GOLD - COMMODITY EXCHANGE INC.","cftc_contract_market_code":"088691","contract_units":"(CONTRACTS OF 100 TROY OUNCES)","futonly_or_combined":"FutOnly","open_interest_all":"406456","noncomm_positions_long_all":"249736","noncomm_positions_short_all":"31104","noncomm_postions_spread_all":"49105","comm_positions_long_all":"58831","comm_positions_short_all":"309798","tot_rept_positions_long_all":"357672","tot_rept_positions_short":"390007","nonrept_positions_long_all":"48784","nonrept_positions_short_all":"16449","change_in_open_interest_all":"-6344","change_in_noncomm_long_all":"-4246","change_in_noncomm_short_all":"2975","pct_of_oi_noncomm_long_all":"61.4","pct_of_oi_noncomm_short_all":"7.7","pct_of_oi_comm_long_all":"14.5","pct_of_oi_comm_short_all":"76.2","traders_tot_all":"286","traders_noncomm_long_all":"162","traders_noncomm_short_all":"53","traders_comm_long_all":"52","traders_comm_short_all":"43"},{"report_date_as_yyyy_mm_dd":"2026-09-22T00:00:00.000","yyyy_report_week_ww":"2026 Report Week 38","market_and_exchange_names":"GOLD - COMMODITY EXCHANGE INC.","cftc_contract_market_code":"088691","contract_units":"(CONTRACTS OF 100 TROY OUNCES)","futonly_or_combined":"FutOnly","open_interest_all":"412800","noncomm_positions_long_all":"253982","noncomm_positions_short_all":"28129","noncomm_postions_spread_all":"48923","comm_positions_long_all":"57458","comm_positions_short_all":"320361","tot_rept_positions_long_all":"360363","tot_rept_positions_short":"397413","nonrept_positions_long_all":"52437","nonrept_positions_short_all":"15387","change_in_open_interest_all":"2901","change_in_noncomm_long_all":"-4077","change_in_noncomm_short_all":"408","pct_of_oi_noncomm_long_all":"61.5","pct_of_oi_noncomm_short_all":"6.8","pct_of_oi_comm_long_all":"13.9","pct_of_oi_comm_short_all":"77.6","traders_tot_all":"293","traders_noncomm_long_all":"174","traders_noncomm_short_all":"47","traders_comm_long_all":"52","traders_comm_short_all":"47"}];

const NOW = Date.parse('2026-10-06T12:00:00Z');
const WEEK = 7 * 86_400_000;

function make(
  o: { disagg?: unknown; legacy?: unknown; status?: number; network?: boolean; now?: number; ttl?: number } = {},
) {
  const calls: string[] = [];
  let t = o.now ?? NOW;
  const mode = { status: o.status ?? 200, network: o.network ?? false, text: undefined as string | undefined };
  const fetchFn = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (mode.network) throw new TypeError('fetch failed');
    if (mode.status !== 200) return new Response('err', { status: mode.status });
    if (mode.text !== undefined) return new Response(mode.text, { status: 200 });
    const body = url.includes('72hh-3qpy') ? (o.disagg ?? DISAGG) : (o.legacy ?? LEGACY);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const cot = createCot({
    fetchFn,
    now: () => t,
    cacheTtlMs: o.ttl ?? 21_600_000,
    retryAfterFailureMs: 60_000,
  });
  return { cot, calls, mode, advance: (ms: number) => { t += ms; } };
}

function series(currentNet: number, weeks = 60) {
  return Array.from({ length: weeks }, (_, k) => {
    const date = new Date(Date.parse('2026-09-29T00:00:00Z') - k * WEEK).toISOString().slice(0, 10);
    const net = k === 0 ? currentNet : 1000 + k * 10;
    return {
      ...DISAGG[0],
      report_date_as_yyyy_mm_dd: `${date}T00:00:00.000`,
      m_money_positions_long_all: String(net + 1000),
      m_money_positions_short_all: '1000',
    };
  });
}

describe('COT gold, Disaggregated (cotGold)', () => {
  it('maps real rows to groups, nets and weekly change', async () => {
    const item: any = await make().cot.cotGold();
    expect(item.available).toBe(true);
    expect(item.source).toBe('cftc_cot_disaggregated');
    const d = item.data;
    expect(d.dataset).toBe('disaggregated');
    expect(d.primaryGroup).toBe('managedMoney');
    expect(d.groups.managedMoney).toEqual({
      long: 131711, short: 11393, spread: 36294, net: 120318,
      pctOfOpenInterestLong: 32.4, pctOfOpenInterestShort: 2.8, tradersLong: 80, tradersShort: 17,
    });
    expect(d.groups.producerMerchant.net).toBe(-21263);
    expect(d.groups.swapDealers.net).toBe(-229704);
    expect(d.groups.otherReportables.net).toBe(98314);
    expect(d.groups.nonReportable.net).toBe(32335);
    expect(d.openInterest).toEqual({ value: 406456, reportedWeeklyChange: -6344 });
    expect(d.primaryNet.value).toBe(120318);
    expect(d.primaryNet.weeklyChange).toBe(-7071);
    expect(d.primaryNet.reportedWeeklyChange).toBe(-7071);
    expect(d.primaryNet.weeklyChangeConsistent).toBe(true);
    expect(d.primaryNet.percentile).toBeNull();
    expect(d.primaryNet.weeksInSample).toBe(2);
  });

  it('reports the report date, age and next release in UTC and WIB', async () => {
    const d = ((await make().cot.cotGold()) as any).data;
    expect(d.report.date).toBe('2026-09-29');
    expect(d.report.yearWeek).toBe('2026 Report Week 39');
    expect(d.report.market).toBe('GOLD - COMMODITY EXCHANGE INC.');
    expect(d.report.contractUnits).toBe('(CONTRACTS OF 100 TROY OUNCES)');
    expect(d.report.ageDays).toBe(7.5);
    expect(d.report.stale).toBe(false);
    expect(d.report.nextReportDate).toBe('2026-10-06');
    expect(d.report.nextReleaseUtc).toBe('2026-10-09T19:30:00.000Z');
    expect(d.report.nextReleaseWib).toBe('2026-10-10T02:30:00.000+07:00');
  });
});

describe('COT gold, Legacy (cotGoldPrimary)', () => {
  it('maps real rows to non-commercial and commercial groups', async () => {
    const item: any = await make().cot.cotGoldPrimary();
    expect(item.available).toBe(true);
    expect(item.source).toBe('cftc_cot_legacy');
    const d = item.data;
    expect(d.dataset).toBe('legacy');
    expect(d.primaryGroup).toBe('nonCommercial');
    expect(d.groups.nonCommercial).toEqual({
      long: 249736, short: 31104, spread: 49105, net: 218632,
      pctOfOpenInterestLong: 61.4, pctOfOpenInterestShort: 7.7, tradersLong: 162, tradersShort: 53,
    });
    expect(d.groups.commercial.net).toBe(-250967);
    expect(d.groups.commercial.pctOfOpenInterestShort).toBe(76.2);
    expect(d.groups.nonReportable.net).toBe(32335);
    expect(d.primaryNet.weeklyChange).toBe(-7221);
    expect(d.primaryNet.weeklyChangeConsistent).toBe(true);
  });
});

describe('cross-check between the two reports', () => {
  it('agrees on report date and open interest for the real rows', async () => {
    const m = make();
    const a: any = await m.cot.cotGold();
    const b: any = await m.cot.cotGoldPrimary();
    expect(a.data.crossCheck).toEqual({ against: 'legacy', sameReportDate: true, openInterestMatches: true });
    expect(b.data.crossCheck).toEqual({ against: 'disaggregated', sameReportDate: true, openInterestMatches: true });
  });

  it('flags an open interest mismatch', async () => {
    const legacy = LEGACY.map((r) => ({ ...r, open_interest_all: '1' }));
    const a: any = await make({ legacy }).cot.cotGold();
    expect(a.data.crossCheck).toEqual({ against: 'legacy', sameReportDate: true, openInterestMatches: false });
  });
});

describe('positioning percentile', () => {
  it('flags a net position at the top of its history', async () => {
    const d = ((await make({ disagg: series(5000) }).cot.cotGold()) as any).data.primaryNet;
    expect(d.weeksInSample).toBe(60);
    expect(d.percentile).toBe(100);
    expect(d.extremeFlag).toBe('near_top_of_range');
    expect(d.min).toBe(1010);
    expect(d.max).toBe(5000);
  });

  it('flags the bottom of the range and leaves the middle unflagged', async () => {
    const low = ((await make({ disagg: series(0) }).cot.cotGold()) as any).data.primaryNet;
    expect(low.percentile).toBe(1.7);
    expect(low.extremeFlag).toBe('near_bottom_of_range');
    const mid = ((await make({ disagg: series(1300) }).cot.cotGold()) as any).data.primaryNet;
    expect(mid.percentile).toBe(51.7);
    expect(mid.extremeFlag).toBeNull();
  });
});

describe('freshness', () => {
  it('marks an old report stale, and unavailable beyond 21 days', async () => {
    const stale: any = await make({ now: Date.parse('2026-10-20T00:00:00Z') }).cot.cotGold();
    expect(stale.available).toBe(true);
    expect(stale.data.report.ageDays).toBe(21);
    expect(stale.data.report.stale).toBe(true);
    const old: any = await make({ now: Date.parse('2026-10-21T00:00:00Z') }).cot.cotGold();
    expect(old).toEqual({ available: false, reason: 'report_too_old' });
  });
});

describe('data quality and failures', () => {
  it('counts rows that are not valid COMEX Gold futures-only rows', async () => {
    const disagg = [
      DISAGG[0],
      { ...DISAGG[0], market_and_exchange_names: 'WHEAT-SRW - CHICAGO BOARD OF TRADE' },
      { ...DISAGG[0], m_money_positions_long_all: 'n/a' },
      { ...DISAGG[0], report_date_as_yyyy_mm_dd: undefined },
      { ...DISAGG[0], futonly_or_combined: 'Combined' },
      'text',
    ];
    const q = ((await make({ disagg }).cot.cotGold()) as any).data.quality;
    expect(q).toEqual({ received: 6, accepted: 1, malformed: 5 });
  });

  it('reports why the data is unavailable', async () => {
    expect(await make({ status: 400 }).cot.cotGold()).toEqual({ available: false, reason: 'HTTP 400' });
    expect(await make({ network: true }).cot.cotGold()).toEqual({ available: false, reason: 'network error' });
    const m = make();
    m.mode.text = '<html>maintenance</html>';
    expect(await m.cot.cotGold()).toEqual({ available: false, reason: 'invalid payload' });
  });

  it('caches, backs off after a failure and serves old data flagged as refreshFailing', async () => {
    const m = make({ ttl: 60_000 });
    await m.cot.cotGold();
    await m.cot.cotGoldPrimary();
    expect(m.calls).toHaveLength(2);
    m.advance(61_000);
    m.mode.status = 500;
    const item: any = await m.cot.cotGold();
    expect(item.available).toBe(true);
    expect(item.data.refreshFailing).toBe(true);
    expect(m.calls).toHaveLength(4);
    m.advance(10_000);
    await m.cot.cotGold();
    expect(m.calls).toHaveLength(4);
  });
});

describe('request', () => {
  it('asks the CFTC API for COMEX Gold, newest first, with the selected columns', async () => {
    const m = make();
    await m.cot.cotGold();
    const dis = m.calls.find((u) => u.includes('72hh-3qpy'))!;
    const leg = m.calls.find((u) => u.includes('6dca-aqww'))!;
    expect(dis).toContain('cftc_contract_market_code=088691');
    expect(dis).toContain('$order=report_date_as_yyyy_mm_dd%20DESC');
    expect(dis).toContain('$limit=157');
    expect(decodeURIComponent(dis)).toContain('swap__positions_short_all');
    expect(decodeURIComponent(dis)).toContain('m_money_positions_long_all');
    expect(decodeURIComponent(leg)).toContain('noncomm_postions_spread_all');
  });
});
