export type VideoGenerationConfig = {
  enabled?: boolean;
  /** Path to MoneyPrinterTurbo installation */
  moneyPrinterPath?: string;
  /** Output directory for generated videos */
  outputPath?: string;
  /** Days to retain generated videos before auto-cleanup */
  retentionDays?: number;
  /** Pexels API key for stock video footage */
  pexelsApiKey?: string;
  /** Pixabay API key for stock video footage */
  pixabayApiKey?: string;
  /** Path to Python 3.10+ executable */
  pythonPath?: string;
};
