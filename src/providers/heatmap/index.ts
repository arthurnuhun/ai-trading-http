export type HeatmapResult =
  | { available: false; reason: string }
  | { available: true; source: string; fetchedAt: string; data: unknown };

export interface HeatmapProvider {
  getHeatmap(): Promise<HeatmapResult>;
}

/** No provider configured: never turn missing data into a bullish/bearish signal. */
export const nullHeatmapProvider: HeatmapProvider = {
  async getHeatmap(): Promise<HeatmapResult> {
    return { available: false, reason: 'No heatmap provider configured' };
  },
};
